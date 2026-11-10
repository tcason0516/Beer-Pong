plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.tcason.beerpong"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.tcason.beerpong"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key so the APK installs directly (sideload).
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    androidResources {
        // keep wav/ogg/mp3 assets uncompressed for fast loading
        noCompress += listOf("wav", "ogg", "mp3", "m4a")
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
