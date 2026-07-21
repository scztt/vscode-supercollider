import * as fs from 'fs'
import {
    homedir,
    platform
} from 'os'
import * as path from 'path'
import { env } from 'process'

const ApplicationName = 'SuperCollider'
const Home = homedir();
const sclangConfYaml = 'sclang_conf.yaml'

// The windows-registry native module can fail to load (e.g. unsupported
// architecture, portable VSCode installs - see issue #42). Registry lookup is
// only used to locate a default sclang path, so degrade gracefully instead of
// failing extension activation.
type GetStringRegKeyFn = (hive: any, path: string, name: string) => string | undefined;
let GetStringRegKey: GetStringRegKeyFn | undefined;
try {
    GetStringRegKey = require('@vscode/windows-registry').GetStringRegKey;
} catch {
    GetStringRegKey = undefined;
}

export function sclangExecutable() {
    switch (platform()) {
        case 'win32': return 'sclang.exe'
        default: return 'sclang'
    }
}

export function userConfigPath() {
    switch (platform()) {
        case 'win32': {
            const localAppData = env.LOCALAPPDATA || path.join(Home, 'AppData', 'Local');
            return path.join(localAppData, ApplicationName);
        }
        case 'darwin': {
            const localAppData = (env.XDG_CONFIG_HOME || env.XDG_DATA_HOME) || path.join(Home, 'Library', 'Application Support')
            return path.join(localAppData, ApplicationName)
        }
        case 'linux':
        case 'freebsd':
        case 'openbsd': {
            const localAppData = env.XDG_CONFIG_HOME || path.join(Home, '.config')
            return path.join(localAppData, ApplicationName)
        }
    }
}

export function sclangConfYamlPath() {
    return path.join(userConfigPath(), sclangConfYaml)
}

function getInstallPathWin() {
    const MAX_MAJOR_VERSION = 20
    const MAX_MINOR_VERSION = 6

    const minorVersions = new Array(MAX_MAJOR_VERSION + 1)
        .fill(null)
        .map((_, i) => i)
        .reverse();

    const patchVersions = new Array(MAX_MINOR_VERSION + 1)
        .fill(null)
        .map((_, i) => i)
        .reverse();

    if (GetStringRegKey !== undefined) {
        try {
            const found = GetStringRegKey('HKEY_CURRENT_USER', `SOFTWARE\\${ApplicationName}\\CurrentVersion`, '')
            if (found) return found;
        } catch { }

        for (const minor of minorVersions) {
            for (const patch of patchVersions) {
                const versionString = `3.${minor}.${patch}`;
                try {
                    const found = GetStringRegKey('HKEY_CURRENT_USER', `SOFTWARE\\${ApplicationName}\\${versionString}`, '')
                    if (found) return found;
                } catch { }
            }
        }
    }

    return 'c:\\Program Files\\SuperCollider';
}

export function sclangPath() {
    switch (platform()) {
        case 'win32': {
            return path.join(getInstallPathWin(), sclangExecutable());
        }
        case 'darwin': {
            return path.join('/Applications', ApplicationName + '.app', 'Contents', 'MacOS', sclangExecutable())
        }
        case 'linux':
        case 'freebsd':
        case 'openbsd': {
            return path.join('usr', 'bin', sclangExecutable())
        }
    }
}
