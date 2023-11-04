import {GetStringRegKey} from '@vscode/windows-registry'
import * as fs from 'fs'
import {homedir,
        platform} from 'os'
import * as path from 'path'
import {env} from 'process'
import {workspace} from 'vscode'

const ApplicationName = 'SuperCollider'
const Home            = homedir();
const sclangConfYaml  = 'sclang_conf.yaml'

export function sclangExecutable()
{
    switch (platform())
    {
        case 'win32': return 'sclang.exe'
        default: return 'sclang'
    }
}

export function userConfigPath() {
    switch (platform())
    {
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

export function sclangPath() {
    switch (platform())
    {
    case 'win32': {
        const installPath = GetStringRegKey('HKEY_LOCAL_MACHINE', `SOFTWARE\\${ApplicationName}\\CurrentVersion`, '') || 'c:\\Program Files\\SuperCollider';
        return path.join(installPath, sclangExecutable());
    }
    case 'darwin': {
        return path.join('/Applications', ApplicationName + '.app', 'Contents', 'MacOS', "zxxzx" + sclangExecutable())
    }
    case 'linux':
    case 'freebsd':
    case 'openbsd': {
        return path.join('usr', 'bin', sclangExecutable())
    }
    }
}
