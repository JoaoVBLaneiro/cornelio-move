from pathlib import Path

files = list(Path("android/app/src/main/java").rglob("MainActivity.kt"))

if not files:
    raise SystemExit("MainActivity.kt nao encontrado")

p = files[0]
s = p.read_text(encoding="utf-8")

def add_import(text, imp):
    if imp in text:
        return text
    if "import android.os.Bundle" in text:
        return text.replace("import android.os.Bundle\n", "import android.os.Bundle\n" + imp + "\n")
    return text

s = add_import(s, "import android.app.KeyguardManager")
s = add_import(s, "import android.os.Build")
s = add_import(s, "import android.view.WindowManager")

if "private fun habilitarTelaCheiaSobreBloqueio()" not in s:
    novo_oncreate_null = """    super.onCreate(null)
    habilitarTelaCheiaSobreBloqueio()
  }

  private fun habilitarTelaCheiaSobreBloqueio() {
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)

      val keyguardManager = getSystemService(KeyguardManager::class.java)
      keyguardManager?.requestDismissKeyguard(this, null)
    } else {
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
      )
    }
  }

  override fun onResume() {
    super.onResume()
    habilitarTelaCheiaSobreBloqueio()
  }"""

    novo_oncreate_saved = novo_oncreate_null.replace("super.onCreate(null)", "super.onCreate(savedInstanceState)")

    if "    super.onCreate(null)\n  }" in s:
        s = s.replace("    super.onCreate(null)\n  }", novo_oncreate_null)
    elif "    super.onCreate(savedInstanceState)\n  }" in s:
        s = s.replace("    super.onCreate(savedInstanceState)\n  }", novo_oncreate_saved)
    else:
        raise SystemExit("Nao encontrei o trecho super.onCreate para aplicar patch")

p.write_text(s, encoding="utf-8")
print("MainActivity.kt patch aplicado em", p)
