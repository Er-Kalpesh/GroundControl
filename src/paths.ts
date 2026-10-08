import { homedir } from 'node:os';
import { join } from 'node:path';

export const getHome = () => process.env.GROUNDCONTROL_HOME ?? join(homedir(), '.groundcontrol');

export const paths = () => {
  const home = getHome();
  return {
    home,
    state: join(home, 'state.json'),
    token: join(home, 'token'),
    daemonPid: join(home, 'daemon.pid'),
    daemonLog: join(home, 'daemon.log'),
    projects: join(home, 'projects.json'),
    shellPath: join(home, 'shell-path'),
    logsDir: join(home, 'logs'),
    audit: join(home, 'audit.log'),
  };
};
