package fr.veryslopnynotes.app

import android.view.Window
import android.view.WindowManager

/**
 * Pose [WindowManager.LayoutParams.FLAG_SECURE] sur la fenêtre selon la
 * décision PURE de [secureWindowRequired]. Le test instrumenté appelle ce
 * câblage avec une vraie fenêtre d'activité : le debug reste capturable, la
 * release n'expose ni l'aperçu des récents ni `screencap`.
 */
internal fun applySecureWindow(window: Window, isDebugBuild: Boolean) {
    if (secureWindowRequired(isDebugBuild)) {
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
}
