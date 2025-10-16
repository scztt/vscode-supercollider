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
    this.statusBarItem.name = "SuperCollider server status";
    this.statusBarItem.color = new vscode.ThemeColor("disabledForeground");
    this.statusBarItem.show();
  }

  getStatusBarItem() {
    return this.statusBarItem;
  }

  formatString(string: string, name, icon, avgCPUFormatted, peakCPUFormatted, numUGens, numSynths, numGroups, numSynthDefs): string {
    string = string.replace("${name}", name)
    string = string.replace("${icon}", icon)
    string = string.replace("${avgCPU}", avgCPUFormatted);
    string = string.replace("${peakCPU}", peakCPUFormatted);
    string = string.replace("${numUGens}", numUGens.toString());
    string = string.replace("${numSynths}", numSynths.toString());
    string = string.replace("${numGroups}", numGroups.toString());
    string = string.replace("${numSynthDefs}", numSynthDefs.toString());

    return string
  }

  updateStatusBar(data: ServerStatusBarData) {
    let {
      name,
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

    this.statusBarItem.color = unresponsive
      ? new vscode.ThemeColor("activityWarningBadge.foreground")
      : running
        ? new vscode.ThemeColor("terminal.ansiGreen")
        : new vscode.ThemeColor("disabledForeground");

    this.statusBarItem.command = unresponsive
      ? "supercollider.internal.rebootServer"
      : running
        ? null
        : "supercollider.internal.bootServer";

    this.statusBarItem.tooltip = unresponsive
      ? "Server is unresponsive. Click to restart."
      : running
        ? "Server is running."
        : "Server is not running. Click to start.";

    const avgCPUFormatted = percentFormatter.format(avgCPU);
    const peakCPUFormatted = percentFormatter.format(peakCPU);

    const configuration = vscode.workspace.getConfiguration()

    const statusString = this.formatString(
      configuration.get<string>('supercollider.serverStatusString'),
      name, icon, avgCPUFormatted, peakCPUFormatted, numUGens, numSynths, numGroups, numSynthDefs);

    const tooltipString = this.formatString(
      "|  |  |\n" +
      "|----------:|:-------|\n" +
      "| **Status** | " + (running ? "🟢 `running`" : "⭕ `stopped`") + " |\n" +
      "| **Average CPU** | `${avgCPU}%` |\n" +
      "| **Peak CPU** | `${peakCPU}%` |\n" +
      "| | |\n" +
      "| **Synths** | `${numSynths}` |\n" +
      "| **Groups** | `${numGroups}` |\n" +
      "| **UGens** | `${numUGens}` |\n" +
      "| | |\n" +
      "| **SynthDefs** | `${numSynthDefs}` |\n",
      name, icon, avgCPUFormatted, peakCPUFormatted, numUGens, numSynths, numGroups, numSynthDefs);

    this.statusBarItem.text = statusString;
    this.statusBarItem.tooltip = new vscode.MarkdownString(tooltipString);
  }
}
