import cron from 'node-cron'
import { importWcaDatabase } from './import_wca'

export function startScheduler() {
  const schedule = process.env.IMPORT_CRON || '0 3 * * *'
  cron.schedule(schedule, async () => {
    console.log('Running WCA import...')
    try {
      await importWcaDatabase()
      console.log('Import finished')
    } catch (err) {
      console.error('Import failed', err)
    }
  })
}
