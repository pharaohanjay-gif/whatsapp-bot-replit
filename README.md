# WhatsApp Auto Post Bot - Memenesia

Bot untuk auto posting ke grup WhatsApp setiap 5 jam.

## Setup di Replit

1. Fork/Import repo ini
2. Klik Run
3. Scan QR Code yang muncul di dashboard
4. Done! Bot akan auto posting setiap 5 jam

## Schedule
- 00:00 WIB
- 05:00 WIB  
- 10:00 WIB
- 15:00 WIB
- 20:00 WIB

## Endpoints
- `/` - Dashboard
- `/health` - Health check (untuk UptimeRobot)
- `/test` - POST to test send
- `/groups` - List target groups
- `/history` - Post history

## UptimeRobot Setup
1. Buat akun di https://uptimerobot.com
2. Add New Monitor
3. Type: HTTP(s)
4. URL: https://YOUR-REPL-NAME.YOUR-USERNAME.repl.co/health
5. Interval: 5 minutes

## Keep Bot Alive
Replit akan sleep setelah tidak ada request. UptimeRobot akan ping `/health` setiap 5 menit untuk menjaga bot tetap hidup.
