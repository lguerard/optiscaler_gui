import fs from "node:fs";
import path from "node:path";
import pngToIco from "png-to-ico";

const rootDir = path.resolve(import.meta.dirname, "..");
const pngPath = path.join(rootDir, "build", "icon.png");
const icoPath = path.join(rootDir, "build", "icon.ico");

const icoBuffer = await pngToIco(pngPath);
fs.writeFileSync(icoPath, icoBuffer);
