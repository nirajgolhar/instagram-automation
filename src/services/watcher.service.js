import chokidar from 'chokidar';
import path from 'path';

export function startWatcher(callback) {
  const watcher = chokidar.watch('downloads', {
    ignoreInitial: true,
    persistent: true
  });

  watcher.on('add', filePath => {
    const ext = path.extname(filePath);
    if (ext === '.mp4') {
      callback(filePath);
    }
  });

  console.log("👀 Watching downloads folder");
}