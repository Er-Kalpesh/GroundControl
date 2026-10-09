import { homedir } from 'node:os';
import { join } from 'node:path';

export const LABEL = 'com.groundcontrol.daemon';
export const plistPath = () => join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * LaunchAgent that starts the daemon at login. KeepAlive only on crash (SuccessfulExit=false) so that
 * `groundcontrol daemon stop` is not undone. GROUNDCONTROL_BOOT=1 makes the daemon autostart services.
 * PATH is captured at install time because launchd's default PATH has no php/npm/docker.
 */
export function plist(o: { node: string; daemon: string; path: string; home?: string; port?: number; logFile: string }): string {
  const env: Record<string, string> = { GROUNDCONTROL_BOOT: '1', PATH: o.path };
  if (o.home) env.GROUNDCONTROL_HOME = o.home;
  if (o.port) env.GROUNDCONTROL_PORT = String(o.port);
  const envXml = Object.entries(env).map(([k, v]) => `    <key>${esc(k)}</key>\n    <string>${esc(v)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(o.node)}</string>
    <string>${esc(o.daemon)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>StandardOutPath</key>
  <string>${esc(o.logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${esc(o.logFile)}</string>
</dict>
</plist>
`;
}
