const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const WebSocket = require("ws");
const { resolveDocument } = require("./path.cjs");
let window, ws, shareRoot;
app.whenReady().then(() => {
  window = new BrowserWindow({
    width: 650,
    height: 560,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.loadFile("index.html");
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (e) => e.preventDefault());
  ipcMain.handle("choose-share", async () => {
    const r = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"],
    });
    if (!r.canceled) shareRoot = r.filePaths[0];
    return shareRoot || "";
  });
  ipcMain.handle("connect", async (_, config) => {
    if (!shareRoot) throw Error("Kies eerst een sharemap");
    const url = new URL(config.server);
    if (
      url.username ||
      url.password ||
      !["https:", "http:"].includes(url.protocol)
    )
      throw Error("Ongeldige server-URL");
    if (
      url.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw Error("Gebruik HTTPS buiten localhost");
    if (!/^[a-f0-9]{64}$/.test(config.ticket)) throw Error("Ongeldig ticket");
    ws?.close();
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/desktop";
    url.search = "";
    url.searchParams.set("ticket", config.ticket);
    ws = new WebSocket(url);
    let busy = false;
    const send = (s) => {
      if (!window.isDestroyed()) window.webContents.send("status", s);
    };
    ws.on("open", () =>
      send("Verbonden. Je kunt nu documenten openen vanuit DoMuS."),
    );
    ws.on("close", () =>
      send("Verbinding verbroken. Koppel opnieuw met een nieuw ticket."),
    );
    ws.on("error", () =>
      send("Verbinding mislukt. Controleer de server en het ticket."),
    );
    ws.on("message", async (bytes) => {
      if (busy) return;
      busy = true;
      try {
        const msg = JSON.parse(bytes.toString());
        if (msg.type !== "open") return;
        const file = await resolveDocument(shareRoot, msg.key);
        const choice = await dialog.showMessageBox(window, {
          type: "question",
          buttons: ["Annuleren", "Openen"],
          defaultId: 0,
          cancelId: 0,
          message: "Document openen?",
          detail:
            path.basename(file) +
            "\n\nBewerkingen op de share wijzigen dit versiebestand. Upload wijzigingen als nieuwe versie om de historie te bewaren.",
        });
        if (choice.response === 1) {
          const error = await shell.openPath(file);
          if (error) throw Error(error);
          send("Geopend: " + path.basename(file));
        }
      } catch (e) {
        send(e.message);
      } finally {
        busy = false;
      }
    });
    return "Verbinding maken…";
  });
});
app.on("window-all-closed", () => {
  ws?.close();
  app.quit();
});
