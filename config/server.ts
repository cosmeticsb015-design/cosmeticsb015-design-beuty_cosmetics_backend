import type { Core } from '@strapi/strapi';
import cronTasks from './cron-tasks';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('URL', `http://localhost:${env.int('PORT', 1337)}`),
  proxy: env.bool('IS_PROXIED', env('NODE_ENV', 'development') === 'production'),
  app: {
    keys: env.array('APP_KEYS'),
  },
  cron: {
    enabled: true,
    // FIX: la auto-detección de config/cron-tasks.ts por convención de
    // nombre de archivo no estaba registrando los jobs en strapi.cron.jobs
    // en este servidor (confirmado en consola: strapi.config.get('cron-tasks')
    // sí traía las tareas, pero strapi.cron.jobs solo mostraba los 3 jobs
    // internos de telemetría de Strapi). Se conecta explícitamente aquí para
    // garantizar que sí se registren.
    tasks: cronTasks,
  },
});

export default config;