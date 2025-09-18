import * as dotenv from "dotenv";
dotenv.config();
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import https from "https";

const DB_USER = process.env.DB_USER || "root";
const DB_PASS = process.env.DB_PASS || "";
const DB_NAME = process.env.DB_NAME || "wca";
const EXPORT_URL =
  "https://assets.worldcubeassociation.org/export/developer/wca-developer-database-dump.zip";

function runCommand(
  cmd: string
): Promise<{ error: any; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(cmd, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr });
    });
  });
}

import { spawn } from "child_process";

function runCommandStreaming(cmd: string, args: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: true });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
          return;
        }
        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      })
      .on("error", (err) => {
        fs.unlinkSync(dest);
        reject(err);
      });
  });
}

async function importDump(
  dbName: string,
  dbUser: string,
  dbPass: string,
  sqlFilePath: string
) {
  console.log("Importing SQL...");

  const child = spawn(
    "mysql",
    [`--user=${dbUser}`, `--password=${dbPass}`, dbName],
    { stdio: ["pipe", "inherit", "inherit"] } // stdin dla dumpa, stdout/stderr na konsolę
  );

  fs.createReadStream(sqlFilePath).pipe(child.stdin);

  await new Promise<void>((resolve, reject) => {
    child.on("close", (code) => {
      if (code === 0) {
        console.log("Import finished");
        resolve();
      } else {
        reject(new Error(`mysql exited with code ${code}`));
      }
    });
  });
}

async function storeExportTimestamp(dbName: string, dbUser: string, dbPass: string, exportTimestamp: string) {
  const sql = `
    CREATE TABLE IF NOT EXISTS wca_statistics_metadata (
      field VARCHAR(255),
      value VARCHAR(255)
    );
    DELETE FROM wca_statistics_metadata WHERE field = 'export_timestamp';
    INSERT INTO wca_statistics_metadata (field, value)
      VALUES ('export_timestamp', '${exportTimestamp}');
  `;

  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "mysql",
      [`--user=${dbUser}`, `--password=${dbPass}`, dbName],
      { stdio: ["pipe", "inherit", "inherit"] }
    );

    child.stdin.write(sql);
    child.stdin.end();

    child.on("close", (code) => {
      if (code === 0) {
        console.log("Metadata stored");
        resolve();
      } else {
        reject(new Error(`mysql exited with code ${code}`));
      }
    });
  });
}

export async function importWcaDatabase() {
  const tmpDir = path.join(__dirname, "..", "tmp");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir);
  }

  const zipPath = path.join(tmpDir, "wca-dump.zip");

  console.log("Downloading WCA export...");
  await downloadFile(EXPORT_URL, zipPath);

  console.log("Unzipping export...");
  await runCommand(`unzip -o ${zipPath} -d ${tmpDir}`);

  const sqlFile = fs.readdirSync(tmpDir).find((f) => f.endsWith(".sql")) || "";
  if (!sqlFile) {
    throw new Error("SQL dump not found in extracted files");
  }
  const sqlFilePath = path.join(tmpDir, sqlFile);

  const mysqlWithCredentials = `mysql --user=${DB_USER} --password=${DB_PASS}`;
  console.log("Recreating database...");
  await runCommandStreaming(
    `mysql --user=${DB_USER} --password=${DB_PASS} -e "DROP DATABASE IF EXISTS ${DB_NAME}; CREATE DATABASE ${DB_NAME};"`
  );

  await importDump(DB_NAME, DB_USER, DB_PASS, sqlFilePath);
  console.log("Database import finished");

  const exportTimestamp = fs.statSync(sqlFilePath).mtime.toISOString();
  await storeExportTimestamp(DB_NAME, DB_USER, DB_PASS, exportTimestamp);
 
}

if (require.main === module) {
  importWcaDatabase().catch((err) => {
    console.error("Import failed", err);
    process.exit(1);
  });
}
