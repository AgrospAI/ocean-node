// Build a narrow 4.2.x deployment patch from exact files exported from the running image.
// Usage: node scripts/build-clone-service-overlay.mjs BASE_FILES_DIR CONTEXT_DIR BASE_IMAGE
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [base, out, image] = process.argv.slice(2);
if (!base || !out || !image?.includes('@sha256:')) throw new Error('Pass base files, output directory and a digest-pinned base image');
const replaceOnce = (source, needle, value) => {
  if (source.split(needle).length !== 2) throw new Error(`Expected exactly one registration marker: ${needle}`);
  return source.replace(needle, value);
};
fs.mkdirSync(out, { recursive: true });
let constants = fs.readFileSync(path.join(base, 'constants.base.js'), 'utf8');
constants = replaceOnce(constants, "ENCRYPT: 'encrypt',", "ENCRYPT: 'encrypt',\n    CLONE_SERVICE_FILES: 'cloneServiceFiles',");
constants = replaceOnce(constants, 'PROTOCOL_COMMANDS.ENCRYPT,', 'PROTOCOL_COMMANDS.ENCRYPT,\n    PROTOCOL_COMMANDS.CLONE_SERVICE_FILES,');
let registry = fs.readFileSync(path.join(base, 'coreHandlersRegistry.base.js'), 'utf8');
registry = "import { CloneServiceFilesHandler } from './cloneServiceFiles.js';\n" + registry;
registry = replaceOnce(registry, 'this.registerCoreHandler(PROTOCOL_COMMANDS.ENCRYPT, new EncryptHandler(node));', 'this.registerCoreHandler(PROTOCOL_COMMANDS.ENCRYPT, new EncryptHandler(node));\n        this.registerCoreHandler(PROTOCOL_COMMANDS.CLONE_SERVICE_FILES, new CloneServiceFilesHandler(node));');
fs.writeFileSync(path.join(out, 'constants.js'), constants);
fs.writeFileSync(path.join(out, 'coreHandlersRegistry.js'), registry);
fs.copyFileSync('dist/components/core/handler/cloneServiceFiles.js', path.join(out, 'cloneServiceFiles.js'));
fs.writeFileSync(path.join(out, 'Dockerfile'), `FROM ${image}\nCOPY constants.js /usr/src/app/dist/utils/constants.js\nCOPY coreHandlersRegistry.js cloneServiceFiles.js /usr/src/app/dist/components/core/handler/\n`);
const hashes = Object.fromEntries(['constants.js','coreHandlersRegistry.js','cloneServiceFiles.js'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(out,file))).digest('hex')]));
fs.writeFileSync(path.join(out, 'provenance.json'), JSON.stringify({ baseImage: image, hashes }, null, 2));
console.log('Built isolated cloning handler image context.');
