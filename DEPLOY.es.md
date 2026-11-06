# Despliegue: el bot 24/7 en un servidor gratis

*English: [DEPLOY.md](DEPLOY.md)*

El bot solo hace conexiones **de salida** hacia Telegram, así que el servidor no necesita página web, dominio ni puertos abiertos aparte de SSH. Sirve cualquier servidor **Ubuntu** pequeño (el bot usa ~50 MB de RAM).

**Resumen:** crear un servidor → conectarte por SSH → ejecutar `deploy/setup.sh` → copiar `.env` y `pills.json` → detener el bot en tu PC.

> ⚠️ Solo puede correr **una copia** del bot a la vez. Cuando arranque la del servidor, detén la de tu PC.

---

## 1. Crear el servidor

Elige uno. Ambos piden una tarjeta para verificar tu identidad; las condiciones gratuitas cambian, revisa la página actual del proveedor.

| | Oracle Cloud "Always Free" | Google Cloud "Free Tier" e2-micro |
|---|---|---|
| Costo | $0; la cuenta no puede cobrarte salvo que la actualices | $0 si no sales de los límites gratis; un error **sí** puede cobrarse |
| Ojo | Oracle puede **recuperar servidores inactivos** (este bot casi no usa CPU). Si pasa, repites esta guía (~15 min) | Solo regiones `us-west1`, `us-central1`, `us-east1`; 1 e2-micro, disco estándar ≤ 30 GB |

### Opción A: Oracle Cloud
1. Regístrate en **cloud.oracle.com**. Elige bien tu **región principal**, porque no se puede cambiar (la más cercana, p. ej. *Colombia Central (Bogotá)*).
2. Menú **☰ → Compute → Instances → Create instance**.
3. **Image:** *Canonical Ubuntu* (última LTS). **Shape:** una marcada **Always Free-eligible** (p. ej. `VM.Standard.E2.1.Micro`, o Ampere `A1.Flex` con 1 OCPU / 6 GB).
4. **Networking:** deja lo predeterminado, con *Assign a public IPv4 address* activado.
5. **SSH keys:** *Generate a key pair for me* → **Save private key** (un archivo `.key`).
6. **Create**. Cuando diga *Running*, copia la **Public IP address**. El usuario es `ubuntu`.

### Opción B: Google Cloud
1. **console.cloud.google.com** → **Compute Engine → VM instances → Create instance**.
2. **Region:** `us-central1`, `us-west1` o `us-east1`. **Machine type:** `e2-micro`.
3. **Boot disk:** Ubuntu (última LTS), *Standard persistent disk*, ≤ 30 GB.
4. **Create**. Conéctate con el botón **SSH** en el navegador (no hace falta archivo de llave). Para copiar archivos usa **⚙ → Upload file** en esa ventana.

---

## 2. Conectarte desde Windows (Oracle / archivo de llave)

Guarda la llave en un lugar seguro, p. ej. `C:\Users\<tú>\.ssh\pill-bot.key`, y restringe sus permisos (si no, SSH la rechaza). En **PowerShell**:

```powershell
icacls $HOME\.ssh\pill-bot.key /inheritance:r /grant:r "$($env:USERNAME):(R)"
ssh -i $HOME\.ssh\pill-bot.key ubuntu@<IP-PÚBLICA>
```

Responde `yes` la primera vez. Estás dentro cuando el prompt se ve como `ubuntu@...:~$`.

## 3. Instalar el bot (en el servidor)

```bash
git clone https://github.com/BerlynDev/pill-reminder-bot.git
cd pill-reminder-bot
bash deploy/setup.sh
```

Instala Node.js y las dependencias, y registra el bot como **servicio** que arranca al encender el servidor y se reinicia si falla. Se detiene en *"Almost done — copy these files…"* porque aún faltan tus archivos privados.

## 4. Copiar tus archivos privados (desde tu PC)

Nunca pasan por GitHub. En **PowerShell en tu PC**, dentro de la carpeta del proyecto:

```powershell
scp -i $HOME\.ssh\pill-bot.key .env pills.json ubuntu@<IP-PÚBLICA>:~/pill-reminder-bot/
# opcional, para conservar tu historial y recordatorios pendientes:
scp -i $HOME\.ssh\pill-bot.key history.json state.json ubuntu@<IP-PÚBLICA>:~/pill-reminder-bot/
```

(Google: súbelos con **⚙ → Upload file** y luego `mv ~/.env ~/pills.json ~/pill-reminder-bot/`.)

Luego **en el servidor** agrega tu zona horaria. Los servidores usan UTC, y sin esto una pastilla de las 08:00 llegaría a las 03:00:

```bash
echo 'TIMEZONE=America/Guayaquil' >> ~/pill-reminder-bot/.env
```

## 5. Cambiar al servidor

1. En tu PC: **Ctrl+C** en la terminal del bot (detén la copia local).
2. En el servidor:
   ```bash
   sudo systemctl restart pill-reminder
   journalctl -u pill-reminder -f
   ```
3. Deberías ver `✅ Connected to Telegram`, `🕒 Timezone: America/Guayaquil — local time now …` (verifica que coincida con tu reloj) y recibir el mensaje de inicio en Telegram. `Ctrl+C` sale del log; el bot sigue corriendo.

---

## Operación diaria (en el servidor)

| Tarea | Comando |
|---|---|
| Log en vivo | `journalctl -u pill-reminder -f` |
| Últimas 50 líneas | `journalctl -u pill-reminder -n 50` |
| ¿Está corriendo? | `systemctl status pill-reminder` |
| Reiniciar | `sudo systemctl restart pill-reminder` |
| Detener / iniciar | `sudo systemctl stop pill-reminder` / `sudo systemctl start pill-reminder` |
| Editar pastillas | `nano ~/pill-reminder-bot/pills.json` (Ctrl+O guardar, Ctrl+X salir), luego reiniciar |
| Actualizar tras un PR | `cd ~/pill-reminder-bot && bash deploy/update.sh` |

**Respaldo del historial** (desde tu PC):
```powershell
scp -i $HOME\.ssh\pill-bot.key ubuntu@<IP-PÚBLICA>:~/pill-reminder-bot/history.json .\history-backup.json
```

**Volver a correrlo en tu PC** (p. ej. si el servidor desaparece): `sudo systemctl stop pill-reminder` en el servidor (si aún existe) y `npm start` en la PC.

## Problemas comunes

| Síntoma | Solución |
|---|---|
| `UNPROTECTED PRIVATE KEY FILE` / `Permission denied (publickey)` | Ejecuta la línea `icacls` del paso 2; revisa que uses `ubuntu@` y la llave correcta |
| SSH no conecta (timeout) | Servidor detenido, IP equivocada o puerto 22 cerrado en el firewall / security list |
| Recordatorios 5 h desfasados | Falta `TIMEZONE` en el `.env` del servidor → agrégalo y reinicia |
| `Conflict: terminated by other getUpdates request` | El bot sigue corriendo también en tu PC → detén uno |
| `$'\r': command not found` | El script tiene finales de línea de Windows; ejecuta `git checkout -- deploy/` (el repo fuerza LF) |
| El servicio se reinicia sin parar | `journalctl -u pill-reminder -n 50` muestra el error (normalmente `.env` / `pills.json`) |
