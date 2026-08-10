package com.skynet.gpsbridge

import android.Manifest
import android.app.*
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.os.IBinder
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors

class GpsBridgeService : Service() {
    companion object {
        const val ACTION_STATUS = "com.skynet.gpsbridge.STATUS"
        private const val CHANNEL_ID = "skynet_gps_bridge"
        private const val PORT = 8765
    }

    private lateinit var fused: FusedLocationProviderClient
    @Volatile private var latest: Location? = null
    @Volatile private var running = false
    private var serverSocket: ServerSocket? = null
    private val pool = Executors.newCachedThreadPool()

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            latest = result.lastLocation
            broadcastStatus()
        }
    }

    override fun onCreate() {
        super.onCreate()
        createChannel()
        fused = LocationServices.getFusedLocationProviderClient(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(
            1001,
            NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentTitle("SKYNET GPS Bridge")
                .setContentText("Serving phone GPS locally on port $PORT")
                .setOngoing(true)
                .build()
        )
        startLocation()
        startServer()
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        try { serverSocket?.close() } catch (_: Exception) {}
        fused.removeLocationUpdates(callback)
        pool.shutdownNow()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startLocation() {
        if (ActivityCompat.checkSelfPermission(
                this, Manifest.permission.ACCESS_FINE_LOCATION
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            stopSelf()
            return
        }

        val request = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            1000L
        )
            .setMinUpdateIntervalMillis(500L)
            .setMaxUpdateDelayMillis(2000L)
            .build()

        fused.requestLocationUpdates(request, callback, mainLooper)
    }

    private fun startServer() {
        if (running) return
        running = true

        pool.execute {
            try {
                serverSocket = ServerSocket(PORT)
                broadcastStatus()

                while (running) {
                    val socket = serverSocket?.accept() ?: break
                    pool.execute { handle(socket) }
                }
            } catch (_: Exception) {
                if (running) broadcastStatus("HTTP bridge error")
            }
        }
    }

    private fun handle(socket: Socket) {
        socket.use { s ->
            try {
                val reader = BufferedReader(InputStreamReader(s.getInputStream()))
                val requestLine = reader.readLine() ?: return
                val path = requestLine.split(" ").getOrNull(1)?.substringBefore("?") ?: "/"

                while (true) {
                    val line = reader.readLine() ?: break
                    if (line.isEmpty()) break
                }

                val body: String
                val status: String

                when (path) {
                    "/gps" -> {
                        body = gpsJson().toString()
                        status = "200 OK"
                    }
                    "/health" -> {
                        body = """{"ok":true,"service":"SKYNET GPS Bridge","version":"2.0"}"""
                        status = "200 OK"
                    }
                    else -> {
                        body = """{"ok":false,"error":"not_found"}"""
                        status = "404 Not Found"
                    }
                }

                writeResponse(s.getOutputStream(), status, body)
            } catch (_: Exception) {}
        }
    }

    private fun gpsJson(): JSONObject {
        val l = latest
        return JSONObject().apply {
            put("valid", l != null)
            if (l != null) {
                put("lat", l.latitude)
                put("lon", l.longitude)
                put("alt", if (l.hasAltitude()) l.altitude else 0.0)
                put("accuracy", if (l.hasAccuracy()) l.accuracy else 0.0)
                put("speed", if (l.hasSpeed()) l.speed else 0.0)
                put("bearing", if (l.hasBearing()) l.bearing else 0.0)
                put("time", l.time)
                put("provider", l.provider ?: "fused")
            }
        }
    }

    private fun writeResponse(out: OutputStream, status: String, body: String) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        val headers = buildString {
            append("HTTP/1.1 $status\r\n")
            append("Content-Type: application/json; charset=utf-8\r\n")
            append("Content-Length: ${bytes.size}\r\n")
            append("Connection: close\r\n")
            append("Cache-Control: no-store\r\n")
            append("Access-Control-Allow-Origin: *\r\n")
            append("\r\n")
        }.toByteArray(Charsets.UTF_8)

        out.write(headers)
        out.write(bytes)
        out.flush()
    }

    private fun broadcastStatus(override: String? = null) {
        val l = latest
        val summary = if (l == null) {
            "Waiting for GPS lock..."
        } else {
            "Lat %.5f\nLon %.5f\nAccuracy ±%.0f m\nSpeed %.1f m/s".format(
                l.latitude,
                l.longitude,
                if (l.hasAccuracy()) l.accuracy else 0f,
                if (l.hasSpeed()) l.speed else 0f
            )
        }

        sendBroadcast(Intent(ACTION_STATUS).apply {
            setPackage(packageName)
            putExtra("status", override ?: if (running) "Bridge active • port $PORT" else "Bridge stopped")
            putExtra("location", summary)
        })
    }

    private fun createChannel() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "SKYNET GPS Bridge",
                NotificationManager.IMPORTANCE_LOW
            )
        )
    }
}
