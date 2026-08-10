SKYNET WARDRIVE v2
===================

Architecture
------------
Android phone
  GPS + hotspot + SKYNET GPS Bridge
        |
        | local Wi-Fi
        v
T-Embed / Bruce
  passive Wi-Fi scan + GPS merge
        |
        v
SD card logs

Why Wi-Fi instead of BLE
------------------------
Stock Bruce JavaScript already exposes Wi-Fi connect + HTTP fetch, while a
general-purpose BLE client/GATT interface is not available to these scripts.

Android setup
-------------
1. Open the Android Studio project:
   SKYNET_GPS_Bridge_Android
2. Build/install it on the phone.
3. Enable Android hotspot.
4. Start SKYNET GPS Bridge.
5. Grant precise location.
6. Note the endpoint shown by the app, for example:
   http://192.168.43.1:8765/gps

Bruce setup
-----------
1. Edit the CONFIG block at the top of SKYNET_Wardrive_v2.js:
   phoneSsid
   phonePassword
   gpsUrl
2. Copy SKYNET_Wardrive_v2.js to Bruce /scripts.
3. Start the phone hotspot and GPS Bridge.
4. Launch SKYNET Wardrive v2.
5. SELECT pauses/resumes.
6. ESC stops and saves.

Output
------
/SKYNET/WARDRIVE/wardrive_<timestamp>.csv
/SKYNET/WARDRIVE/wardrive_<timestamp>_summary.txt

CSV fields
----------
timestamp
latitude / longitude
altitude
GPS accuracy
speed
bearing
SSID
BSSID
security
RSSI (when exposed by Bruce)
channel (when exposed by Bruce)
hidden flag
new-BSSID flag

The app also tracks:
- unique APs
- total observations
- new APs per cycle
- open and hidden observations
- approximate distance traveled from GPS points
- session duration

WiGLE note
----------
A reliable WiGLE-style export requires fields such as RSSI and channel.
This v2 does NOT invent them.

If your Bruce build exposes RSSI/channel in wifi.scan(), the app detects and
uses them automatically. Otherwise the SKYNET CSV remains the reliable output.

Privacy
-------
The Android app serves GPS only on the phone's local network. The supplied
source does not upload location anywhere.

The T-Embed performs passive Wi-Fi discovery only.
