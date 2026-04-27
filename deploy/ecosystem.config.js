module.exports = {
  apps: [{
    name:        'vocab',
    script:      'server.js',
    cwd:         '/var/www/vocab',
    exec_mode:   'fork',
    instances:   1,
    autorestart: true,
    watch:       false,
  }],
};
