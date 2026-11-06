const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Set custom user data path in temp to prevent any Windows cache locking conflicts
app.name = 'nectar';
const customDataPath = path.join(app.getPath('temp'), 'nectar-desktop-profile');
try {
  fs.mkdirSync(customDataPath, { recursive: true });
  app.setPath('userData', customDataPath);
} catch {}

// Prevent cache lock collisions & GPU cache errors on Windows
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-http-cache');

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  const filePath = path.join(__dirname, 'dist', reqPath);

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(content, 'utf-8');
    }
  });
});

let serverPort = 1420;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // If 1420 is in use, pick a random available port
    server.listen(0, '127.0.0.1');
  }
});

server.listen(1420, '127.0.0.1', () => {
  serverPort = server.address().port;
  console.log(`Nectar Desktop Server running on http://127.0.0.1:${serverPort}`);
  if (app.isReady()) createWindow();
});

let mainWindow = null;

function createWindow() {
  if (mainWindow) return;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width } = primaryDisplay.bounds;

  mainWindow = new BrowserWindow({
    width: width || 1920,
    height: 420,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/index.html`);

  mainWindow.on('closed', () => {
    mainWindow = null;
    server.close();
  });
}

app.whenReady().then(() => {
  if (server.listening) {
    createWindow();
  }
});

app.on('second-instance', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  server.close();
  app.quit();
});
