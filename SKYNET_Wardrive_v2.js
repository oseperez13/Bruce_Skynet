/*
 * SKYNET WARDRIVE v2.0
 * Bruce JavaScript app for LILYGO T-Embed / T-Embed CC1101 Plus
 *
 * PHONE GPS TRANSPORT
 * -------------------
 * Android phone provides:
 *   http://<phone-ip>:8765/gps
 *
 * T-Embed:
 *   1) connects to phone hotspot
 *   2) fetches GPS
 *   3) passively scans nearby Wi-Fi
 *   4) merges GPS + AP observations
 *   5) auto-saves until ESC
 *
 * STOCK BRUCE LIMITATION
 * ----------------------
 * wifi.scan() may only expose SSID, MAC/BSSID and encryptionType.
 * This app automatically uses RSSI/channel if a custom/current Bruce build
 * exposes them. It never fabricates those values.
 */

var display = require("display");
var wifi = require("wifi");
var keyboard = require("keyboard");
var storage = require("storage");

var W = display.width();
var H = display.height();

function C(r,g,b){ return display.color(r,g,b); }
var BG=C(4,8,14), PANEL=C(10,19,29), PANEL2=C(15,29,42);
var CYAN=C(0,220,255), GREEN=C(68,255,154), YELLOW=C(255,207,64);
var RED=C(255,84,100), WHITE=C(238,247,255), MUTED=C(125,151,170);
var DIM=C(56,79,96);

// ------------ USER CONFIG ------------
var CONFIG = {
    phoneSsid: "SKYNET-GPS",
    phonePassword: "CHANGE_ME",
    gpsUrl: "http://192.168.43.1:8765/gps",
    reconnectTimeoutSec: 10,
    scanIntervalMs: 2500,
    logFs: "sd"
};
// -------------------------------------

var state = {
    running: true,
    paused: false,
    gpsOk: false,
    phoneOk: false,
    gps: {lat:0, lon:0, alt:0, accuracy:0, speed:0, bearing:0, time:0},
    sessionStart: now(),
    cycles: 0,
    observations: 0,
    unique: 0,
    newThisCycle: 0,
    openCount: 0,
    hiddenCount: 0,
    distanceM: 0,
    lastPoint: null,
    hasRssi: false,
    hasChannel: false,
    status: "READY",
    lastAp: null
};

var seen = {};
var SESSION = String(now());
var ROOT = "/SKYNET/WARDRIVE";
var CSV = ROOT + "/wardrive_" + SESSION + ".csv";
var META = ROOT + "/wardrive_" + SESSION + "_summary.txt";

function txt(s,x,y,z,c){
    display.setTextSize(z||1);
    display.setTextColor(c||WHITE);
    display.setTextAlign("left","top");
    display.drawText(String(s),x,y);
}
function txtR(s,x,y,z,c){
    display.setTextSize(z||1);
    display.setTextColor(c||WHITE);
    display.setTextAlign("right","top");
    display.drawText(String(s),x,y);
}
function txtC(s,x,y,z,c){
    display.setTextSize(z||1);
    display.setTextColor(c||WHITE);
    display.setTextAlign("center","top");
    display.drawText(String(s),x,y);
}
function card(x,y,w,h,c){
    display.drawFillRoundRect(x,y,w,h,7,PANEL);
    display.drawRoundRect(x,y,w,h,7,c||DIM);
}
function header(title,sub){
    display.fill(BG);
    display.drawFillRect(0,0,W,27,PANEL2);
    display.drawFillRect(0,26,W,1,CYAN);
    txt("SKYNET",8,5,2,CYAN);
    txtR(title,W-8,6,1,WHITE);
    if(sub) txt(sub,8,30,1,MUTED);
}
function footer(l,r){
    display.drawFillRect(0,H-17,W,17,PANEL2);
    display.drawFillRect(0,H-18,W,1,DIM);
    txt(l,7,H-13,1,MUTED);
    txtR(r,W-7,H-13,1,CYAN);
}
function shortText(s,n){
    s=String(s||"");
    return s.length<=n ? s : s.substring(0,n-3)+"...";
}
function esc(v){
    var s=String(v===null||v===undefined?"":v);
    return '"'+s.replace(/"/g,'""')+'"';
}
function getRssi(n){
    if(typeof n.RSSI==="number") return n.RSSI;
    if(typeof n.rssi==="number") return n.rssi;
    return null;
}
function getChannel(n){
    if(typeof n.channel==="number") return n.channel;
    if(typeof n.Channel==="number") return n.Channel;
    if(typeof n.CH==="number") return n.CH;
    return null;
}
function isOpen(enc){
    return enc==="OPEN" || enc==="NONE";
}
function fmtCoord(v){
    return (Math.round(v*100000)/100000).toFixed(5);
}
function fmtElapsed(ms){
    var s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=s%60;
    function p(v){return v<10?"0"+v:String(v);}
    return p(h)+":"+p(m)+":"+p(ss);
}
function csvEscape(v){ return esc(v); }

function initLog(){
    try{
        storage.mkdir({fs:CONFIG.logFs,path:"/SKYNET"});
        storage.mkdir({fs:CONFIG.logFs,path:ROOT});
        storage.write(
            {fs:CONFIG.logFs,path:CSV},
            "timestamp_ms,latitude,longitude,altitude_m,accuracy_m,speed_mps,bearing_deg,ssid,bssid,security,rssi_dbm,channel,hidden,new_bssid\n",
            "write"
        );
        return true;
    }catch(e){
        return false;
    }
}

function saveSummary(){
    try{
        var s=
            "SKYNET Wardrive v2\n"+
            "Session: "+SESSION+"\n"+
            "Cycles: "+state.cycles+"\n"+
            "Observations: "+state.observations+"\n"+
            "Unique BSSIDs: "+state.unique+"\n"+
            "Open observations: "+state.openCount+"\n"+
            "Hidden observations: "+state.hiddenCount+"\n"+
            "Distance m: "+Math.round(state.distanceM)+"\n"+
            "RSSI available: "+state.hasRssi+"\n"+
            "Channel available: "+state.hasChannel+"\n";
        storage.write({fs:CONFIG.logFs,path:META},s,"write");
    }catch(e){}
}

function appendObs(n,isNew){
    var rssi=getRssi(n),ch=getChannel(n),hidden=(!n.SSID||!String(n.SSID).length);
    try{
        var line=
            csvEscape(state.gps.time||now())+","+
            csvEscape(state.gps.lat)+","+
            csvEscape(state.gps.lon)+","+
            csvEscape(state.gps.alt)+","+
            csvEscape(state.gps.accuracy)+","+
            csvEscape(state.gps.speed)+","+
            csvEscape(state.gps.bearing)+","+
            csvEscape(n.SSID||"")+","+
            csvEscape(n.MAC||"")+","+
            csvEscape(n.encryptionType||"")+","+
            csvEscape(rssi===null?"":rssi)+","+
            csvEscape(ch===null?"":ch)+","+
            (hidden?"true":"false")+","+
            (isNew?"true":"false")+"\n";
        storage.write({fs:CONFIG.logFs,path:CSV},line,"append");
    }catch(e){
        state.status="SD WRITE ERROR";
    }
}

function ensurePhoneWifi(){
    if(wifi.connected()){
        state.phoneOk=true;
        return true;
    }

    state.status="CONNECTING PHONE";
    var ok=false;
    try{
        ok=wifi.connect(CONFIG.phoneSsid,CONFIG.reconnectTimeoutSec,CONFIG.phonePassword);
    }catch(e){
        ok=false;
    }
    state.phoneOk=ok;
    return ok;
}

function parseGps(body){
    try{
        var g=JSON.parse(body);
        if(!g||!g.valid) return false;

        var next = {
            lat:Number(g.lat||0),
            lon:Number(g.lon||0),
            alt:Number(g.alt||0),
            accuracy:Number(g.accuracy||0),
            speed:Number(g.speed||0),
            bearing:Number(g.bearing||0),
            time:Number(g.time||now())
        };

        if(state.lastPoint){
            state.distanceM += haversine(
                state.lastPoint.lat,state.lastPoint.lon,
                next.lat,next.lon
            );
        }

        state.lastPoint={lat:next.lat,lon:next.lon};
        state.gps=next;
        state.gpsOk=true;
        return true;
    }catch(e){
        return false;
    }
}

function haversine(lat1,lon1,lat2,lon2){
    var R=6371000;
    var toRad=Math.PI/180;
    var p1=lat1*toRad,p2=lat2*toRad;
    var dp=(lat2-lat1)*toRad,dl=(lon2-lon1)*toRad;
    var a=Math.sin(dp/2)*Math.sin(dp/2)+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)*Math.sin(dl/2);
    var c=2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
    return R*c;
}

function fetchGps(){
    if(!ensurePhoneWifi()){
        state.gpsOk=false;
        state.status="PHONE HOTSPOT LOST";
        return false;
    }

    try{
        var r=wifi.httpFetch(CONFIG.gpsUrl,{
            method:"GET",
            headers:{"Accept":"application/json"}
        });

        if(r&&r.ok&&parseGps(r.body)){
            state.status="GPS LOCK";
            return true;
        }
    }catch(e){}

    state.gpsOk=false;
    state.status="GPS BRIDGE ERROR";
    return false;
}

function cycleOnce(){
    if(!fetchGps()) return;

    var nets=[];
    try{
        nets=wifi.scan()||[];
    }catch(e){
        state.status="WIFI SCAN ERROR";
        return;
    }

    state.cycles++;
    state.newThisCycle=0;

    for(var i=0;i<nets.length;i++){
        var n=nets[i];
        var key=n.MAC||("ssid:"+(n.SSID||""));
        var isNew=!seen[key];

        if(isNew){
            seen[key]=true;
            state.unique++;
            state.newThisCycle++;
        }

        var rssi=getRssi(n),ch=getChannel(n);
        if(rssi!==null) state.hasRssi=true;
        if(ch!==null) state.hasChannel=true;
        if(isOpen(n.encryptionType||"")) state.openCount++;
        if(!n.SSID||!String(n.SSID).length) state.hiddenCount++;

        state.observations++;
        state.lastAp=n;
        appendObs(n,isNew);
    }

    state.status="LOGGING";
}

function draw(){
    header("WARDRIVE",state.paused?"PAUSED":"REC");

    card(7,46,W-14,37,state.gpsOk?GREEN:RED);
    txt("PHONE GPS",14,53,1,MUTED);
    if(state.gpsOk){
        txt(fmtCoord(state.gps.lat),14,66,1,WHITE);
        txtR(fmtCoord(state.gps.lon),W-14,66,1,WHITE);
    }else{
        txt("Waiting for GPS...",14,66,1,YELLOW);
    }

    var gap=5,cw=Math.floor((W-19)/3);
    card(7,89,cw,42,CYAN);
    txt("UNIQUE",13,96,1,MUTED);
    txt(String(state.unique),13,110,2,WHITE);

    card(7+cw+gap,89,cw,42,GREEN);
    txt("OBS",13+cw+gap,96,1,MUTED);
    txt(String(state.observations),13+cw+gap,110,2,GREEN);

    card(7+(cw+gap)*2,89,cw,42,YELLOW);
    txt("NEW",13+(cw+gap)*2,96,1,MUTED);
    txt(String(state.newThisCycle),13+(cw+gap)*2,110,2,CYAN);

    txt("DIST "+(Math.round(state.distanceM)/1000).toFixed(2)+" km",8,136,1,CYAN);
    txtR(fmtElapsed(now()-state.sessionStart),W-8,136,1,MUTED);

    if(state.lastAp){
        txt(shortText(state.lastAp.SSID||"<hidden>",22),8,148,1,WHITE);
        var rssi=getRssi(state.lastAp),ch=getChannel(state.lastAp);
        var right="";
        if(rssi!==null) right+=rssi+"dBm ";
        if(ch!==null) right+="CH"+ch;
        if(!right) right=shortText(state.lastAp.encryptionType||"",10);
        txtR(right,W-8,148,1,state.hasRssi?GREEN:YELLOW);
    }

    footer("SELECT pause","ESC stop");
}

function configNotice(){
    header("SETUP","Edit CONFIG first");
    card(9,50,W-18,75,YELLOW);
    txt("Phone hotspot SSID:",17,59,1,MUTED);
    txt(shortText(CONFIG.phoneSsid,24),17,73,1,WHITE);
    txt("GPS endpoint:",17,89,1,MUTED);
    txt(shortText(CONFIG.gpsUrl,34),17,103,1,CYAN);
    txt("Change password in script.",17,118,1,YELLOW);
    footer("Any key","CONTINUE");
    delay(250);
    while(!keyboard.getAnyPress()) delay(45);
}

// Splash
display.fill(BG);
display.drawFillRoundRect(18,43,W-36,95,12,PANEL);
display.drawRoundRect(18,43,W-36,95,12,CYAN);
txtC("SKYNET",W/2,57,3,CYAN);
txtC("WARDRIVE v2",W/2,93,2,WHITE);
txtC("PHONE GPS EDITION",W/2,119,1,GREEN);
delay(1100);

initLog();
configNotice();

var nextScan=0;
while(state.running){
    if(keyboard.getEscPress()){
        state.running=false;
        break;
    }

    if(keyboard.getSelPress()){
        state.paused=!state.paused;
        state.status=state.paused?"PAUSED":"RESUMING";
        delay(180);
    }

    if(!state.paused && now()>=nextScan){
        cycleOnce();
        nextScan=now()+CONFIG.scanIntervalMs;
    }

    draw();
    delay(80);
}

try{wifi.disconnect();}catch(e){}
saveSummary();

header("SESSION SAVED","SKYNET Wardrive");
txtC(state.unique+" unique APs",W/2,61,2,GREEN);
txtC(state.observations+" observations",W/2,89,1,WHITE);
txtC((Math.round(state.distanceM)/1000).toFixed(2)+" km",W/2,107,1,CYAN);
txtC(shortText(CSV,42),W/2,127,1,DIM);
footer("Any key","SAVED");
delay(250);
while(!keyboard.getAnyPress()) delay(45);
