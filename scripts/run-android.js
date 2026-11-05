const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const androidDir = path.join(root, 'android');
const gradlew = path.join(androidDir, 'gradlew');
const apk = path.join(androidDir, 'app/build/outputs/apk/debug/app-debug.apk');
const expo = path.join(root, 'node_modules/.bin/expo');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const sdkAdb = sdk && path.join(sdk, 'platform-tools/adb');
const adb = sdkAdb && fs.existsSync(sdkAdb) ? sdkAdb : 'adb';

function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited ${signal || `with code ${code}`}`));
    });
  });
}

function connectedDevice() {
  const output = execFileSync(adb, ['devices'], { encoding: 'utf8' });
  const devices = output.split(/\r?\n/).slice(1)
    .map(line => line.trim().split(/\s+/))
    .filter(parts => parts[1] === 'device')
    .map(parts => parts[0]);
  if (devices.length !== 1) {
    throw new Error(`Expected one authorized Android device; found ${devices.length}. Check "adb devices".`);
  }
  return devices[0];
}

function portIsFree(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

function existingMetroProject() {
  return new Promise(resolve => {
    const request = http.get('http://127.0.0.1:8081/status', response => {
      response.resume();
      resolve(response.headers['x-react-native-project-root'] === root);
    });
    request.setTimeout(1500, () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
  });
}

async function main() {
  console.log('Neotree Android runner: building and installing without ADB streaming');
  const serial = connectedDevice();
  const architecture = execFileSync(adb, ['-s', serial, 'shell', 'getprop', 'ro.product.cpu.abi'], { encoding: 'utf8' }).trim();
  if (!/^[a-z0-9_-]+$/.test(architecture)) throw new Error(`Could not read a valid CPU architecture from ${serial}`);
  console.log(`Using Android device ${serial} (${architecture})`);

  if (!fs.existsSync(gradlew)) {
    console.log('Generating the Android project...');
    await run(expo, ['prebuild', '--platform', 'android', '--no-install']);
  }

  console.log('Building the debug APK...');
  await run(gradlew, [':app:assembleDebug', `-PreactNativeArchitectures=${architecture}`, '--console=plain'], androidDir);
  if (!fs.existsSync(apk)) throw new Error(`Build finished without an APK: ${apk}`);

  console.log('Installing with ADB nonstreaming mode...');
  await run(adb, ['-s', serial, 'install', '--no-streaming', '-r', apk]);

  // The debug APK uses 8081. Choosing another Metro port without rebuilding the
  // native debug host leaves Android on the splash screen or crashes at launch.
  if (!await portIsFree(8081)) {
    if (!await existingMetroProject()) {
      throw new Error('Port 8081 is occupied by another server. Stop it, then run npm run android again.');
    }
    console.log('Reusing this project\'s Metro server on port 8081.');
    await run(adb, ['-s', serial, 'reverse', 'tcp:8081', 'tcp:8081']);
    await run(adb, ['-s', serial, 'shell', 'am', 'start', '-n', 'app.neotree.analytics/.MainActivity']);
    return;
  }
  await run(adb, ['-s', serial, 'reverse', 'tcp:8081', 'tcp:8081']);
  console.log('Starting Metro on port 8081 and opening the app...');
  await run(expo, ['start', '--dev-client', '--android', '--host', 'localhost', '--port', '8081']);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
