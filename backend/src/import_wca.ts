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
  await runCommand(
    `${mysqlWithCredentials} -e "DROP DATABASE IF EXISTS ${DB_NAME}"`
  );
  await runCommand(`${mysqlWithCredentials} -e "CREATE DATABASE ${DB_NAME}"`);

  console.log("Importing SQL...");
  await runCommand(`${mysqlWithCredentials} ${DB_NAME} < ${sqlFilePath}`);
  console.log("Database import finished");

  const exportTimestamp = fs.statSync(sqlFilePath).mtime.toISOString();
  const storeMetadataSQL = `
    CREATE TABLE IF NOT EXISTS wca_statistics_metadata (
      field VARCHAR(255),
      value VARCHAR(255)
    );
    DELETE FROM wca_statistics_metadata WHERE field = 'export_timestamp';
    INSERT INTO wca_statistics_metadata (field, value) 
      VALUES ('export_timestamp', '${exportTimestamp}');
  `;
  await runCommand(
    `${mysqlWithCredentials} ${DB_NAME} -e "${storeMetadataSQL.replace(
      /\n/g,
      " "
    )}"`
  );

  console.log("Metadata stored");
}

if (require.main === module) {
  importWcaDatabase().catch((err) => {
    console.error("Import failed", err);
    process.exit(1);
  });
}
