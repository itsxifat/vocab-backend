module.exports = {
  apps: [{
    name:         'vocab',
    script:       'server.js',
    cwd:          '/var/www/vocab',
    instances:    1,
    autorestart:  true,
    watch:        false,
    env_file:     '/var/www/vocab/.env.production',
  }],
};
