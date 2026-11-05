plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.orbitbtc.galacticfrontier"
    compileSdk = 34

    defaultConfig {
        // Standalone test app: a separate id (and ".debug" suffix below) so it can never replace or
        // collide with the real OrbitBTC app.
        applicationId = "com.orbitbtc.galacticfrontier.standalone"
        minSdk = 24
        targetSdk = 34
        versionCode = 7
        versionName = "0.7.0-m7"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            isDebuggable = true
        }
        release {
            // Not published: no signing config is provided. Only the debug APK is built in CI.
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
    // The bundled game is a single pre-compressed HTML file; keep it byte-identical.
    androidResources { noCompress += listOf("html") }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
}
