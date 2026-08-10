package com.skynet.gpsbridge

import android.Manifest
import android.content.*
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.net.NetworkInterface

class MainActivity : AppCompatActivity() {
    private lateinit var statusText: TextView
    private lateinit var endpointText: TextView
    private lateinit var locationText: TextView

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != GpsBridgeService.ACTION_STATUS) return
            statusText.text = intent.getStringExtra("status") ?: "Running"
            locationText.text = intent.getStringExtra("location") ?: "Waiting for GPS"
            endpointText.text = "Endpoint: http://${findIpv4()}:8765/gps"
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusText = findViewById(R.id.statusText)
        endpointText = findViewById(R.id.endpointText)
        locationText = findViewById(R.id.locationText)

        findViewById<Button>(R.id.startButton).setOnClickListener { ensurePermissionAndStart() }
        findViewById<Button>(R.id.stopButton).setOnClickListener {
            stopService(Intent(this, GpsBridgeService::class.java))
            statusText.text = "Bridge stopped"
        }

        endpointText.text = "Endpoint: http://${findIpv4()}:8765/gps"
    }

    override fun onStart() {
        super.onStart()
        ContextCompat.registerReceiver(
            this,
            receiver,
            IntentFilter(GpsBridgeService.ACTION_STATUS),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
    }

    override fun onStop() {
        unregisterReceiver(receiver)
        super.onStop()
    }

    private fun ensurePermissionAndStart() {
        if (ActivityCompat.checkSelfPermission(
                this, Manifest.permission.ACCESS_FINE_LOCATION
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                ),
                101
            )
            return
        }
        startBridge()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 101 &&
            grantResults.isNotEmpty() &&
            grantResults[0] == PackageManager.PERMISSION_GRANTED
        ) startBridge()
    }

    private fun startBridge() {
        ContextCompat.startForegroundService(
            this,
            Intent(this, GpsBridgeService::class.java)
        )
        statusText.text = "Starting SKYNET GPS Bridge..."
    }

    private fun findIpv4(): String {
        return try {
            val addresses = NetworkInterface.getNetworkInterfaces().toList()
                .flatMap { it.inetAddresses.toList() }
                .filter { !it.isLoopbackAddress && it.hostAddress?.contains(":") == false }
                .mapNotNull { it.hostAddress }

            addresses.firstOrNull { it.startsWith("192.168.") }
                ?: addresses.firstOrNull { it.startsWith("172.") }
                ?: addresses.firstOrNull { it.startsWith("10.") }
                ?: "PHONE_IP"
        } catch (_: Exception) {
            "PHONE_IP"
        }
    }
}
