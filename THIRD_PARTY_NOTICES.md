# Phidias CLI

`server/terminal.js`, `server/console.js` and `server/config.js` adapt the terminal transport, command parser/mode handling and configuration-state/file-writing code from:

- Project: OpacIT Omphalos Phidias
- Source checkout: `/home/d6/Documents/GitHub/Sentinel-Builder`
- Original files: `lib/terminal.js`, `lib/console.js`, `lib/config.js`
- License declared by that project: GPL-3.0-only
- Original license text: [licenses/Phidias-GPL-3.0.txt](licenses/Phidias-GPL-3.0.txt)

DoMuS adaptations include ES modules, SQL/IMAP/SMTP/storage settings, host/port-derived origins, standalone configuration, redaction of service credentials and draining buffered terminal input at EOF. The original project is not modified.
