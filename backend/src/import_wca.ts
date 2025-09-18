import { exec } from "child_process"
import fs from "fs"
import path from "path"
import https from "https"
import unzipper from "unzipper"

const DB_USER = process.env.DB_USER || "root"
const DB_PASS = process.env.DB_PASS || ""
const DB_NAME = process.env.DB_NAME || "wca"
const EXPORT_URL =
  "https://www.worldcubeassociation.org/wst/wca-developer-database-dump.zip"

function runCommand(cmd: string): Promise<{ error: any; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(cmd, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr })
    })
  })
}

export async function importWcaDatabase() {
  const tmpDir = path.join(__dirname, "..", "tmp")
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir)
  }

  const zipPath = path.join(tmpDir, "wca-dump.zip")

  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(zipPath)
    https
      .get(EXPORT_URL, (response) => {
        response.pipe(file)
        file.on("finish", () => {
          file.close()
          resolve()
        })
      })
      .on("error", (err) => {
        reject(err)
      })
  })

  await fs
    .createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: tmpDir }))
    .promise()

  const sqlFile = fs
    .readdirSync(tmpDir)
    .find((f) => f.endsWith(".sql")) || ""

  const mysqlWithCredentials = `mysql --user=${DB_USER} --password=${DB_PASS}`
  await runCommand(`${mysqlWithCredentials} -e "DROP DATABASE IF EXISTS ${DB_NAME}"`)
  await runCommand(`${mysqlWithCredentials} -e "CREATE DATABASE ${DB_NAME}"`)
  await runCommand(`${mysqlWithCredentials} ${DB_NAME} < ${path.join(tmpDir, sqlFile)}`)
  console.log("Database import finished")
}

if (require.main === module) {
  importWcaDatabase().catch((err) => {
    console.error("Import failed", err)
    process.exit(1)
  })
}
