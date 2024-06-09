import * as vscode from "vscode";

export type ServerStatusBarData = {
  name?: string;
  running: boolean;
  unresponsive: boolean;
  avgCPU: number;
  peakCPU: number;
  numUGens: number;
  numSynths: number;
  numGroups: number;
  numSynthDefs: number;
};

export class ServerStatusBar {
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.name = "Supercollider Server Status";
    this.statusBarItem.show();
  }

  getStatusBarItem() {
    return this.statusBarItem;
  }

  updateStatusBar(data: ServerStatusBarData) {
    let {
      running,
      unresponsive,
      avgCPU,
      peakCPU,
      numUGens,
      numSynths,
      numGroups,
      numSynthDefs,
    } = data;
    if (!running) {
      unresponsive = false;
      avgCPU = 0;
      peakCPU = 0;
      numUGens = 0;
      numSynths = 0;
      numGroups = 0;
      numSynthDefs = 0;
    }
    const percentFormatter = Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2
    });

    const icon = unresponsive
      ? `$(warning)`
      : running
      ? `$(play)`
      : `$(primitive-square)`;

    this.statusBarItem.command = unresponsive
      ? "supercollider.internal.rebootServer"
      : running
      ? "supercollider.internal.killAllServers"
      : "supercollider.internal.bootServer";

    this.statusBarItem.tooltip = unresponsive
      ? "Server is unresponsive. Click to restart."
      : running
      ? "Server is running. Click to stop."
      : "Server is not running. Click to start.";

    const avgCPUFormatted = percentFormatter.format(avgCPU);

    const peakCPUFormatted = percentFormatter.format(peakCPU);

    this.statusBarItem.text = `${icon} ${avgCPUFormatted}% ${peakCPUFormatted}% ${numUGens}u ${numSynths}s ${numGroups}g ${numSynthDefs}d`;
  }
}
