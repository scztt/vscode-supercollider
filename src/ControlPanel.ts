import * as vscode from "vscode";

// Interface definitions for control specifications
export interface NumericSpec {
  type: 'numeric';
  min: number;
  max: number;
  step: number; // 0 for no grid
  unit?: string; // e.g., "hz"
  mapping: 'lin' | 'linear' | 'exp' | 'exponential' | 'sin' | 'cos' | 'db' | number;
  decimals: number; // number of decimal places to display
}

export interface StringSpec {
  type: 'string';
  displayPropertyName?: boolean; // Whether to show the property name (default: true)
}

export interface ActionSpec {
  type: 'action';
  enabled?: boolean; // Whether the action can be triggered (default: true)
  toggleable?: boolean; // Whether this is a toggle action (default: false)
  iconOn?: string; // VSCode icon name when toggled on (e.g., 'play', 'record')
  iconOff?: string; // VSCode icon name when toggled off (e.g., 'stop', 'circle-large-outline')
  colorOn?: string; // VSCode theme color when on (e.g., 'terminal.ansiGreen')
  colorOff?: string; // VSCode theme color when off (e.g., 'disabledForeground')
}

// Mapping utility functions
function dbToAmp(db: number): number {
  return Math.pow(10, db / 20);
}

function ampToDb(amp: number): number {
  return 20 * Math.log10(Math.max(amp, 1e-10)); // Avoid log of 0
}

function lincurve(value: number, inMin: number, inMax: number, outMin: number, outMax: number, curve: number): number {
  // Clip input
  if (value <= inMin) return outMin;
  if (value >= inMax) return outMax;
  
  if (Math.abs(curve) < 0.001) {
    // Linear mapping
    return (value - inMin) / (inMax - inMin) * (outMax - outMin) + outMin;
  }
  
  const grow = Math.exp(curve);
  const a = (outMax - outMin) / (1.0 - grow);
  const b = outMin + a;
  const scaled = (value - inMin) / (inMax - inMin);
  
  return b - (a * Math.pow(grow, scaled));
}

function curvelin(value: number, inMin: number, inMax: number, outMin: number, outMax: number, curve: number): number {
  // Clip input
  if (value <= inMin) return outMin;
  if (value >= inMax) return outMax;
  
  if (Math.abs(curve) < 0.001) {
    // Linear mapping
    return (value - inMin) / (inMax - inMin) * (outMax - outMin) + outMin;
  }
  
  const grow = Math.exp(curve);
  const a = (inMax - inMin) / (1.0 - grow);
  const b = inMin + a;
  
  return Math.log((b - value) / a) * (outMax - outMin) / curve + outMin;
}

// Normalize value from spec range to [0, 1]
function normalizeValue(value: number, spec: NumericSpec): number {
  const mapping = spec.mapping;
  
  if (typeof mapping === 'number') {
    // Numeric warp/curve value
    return curvelin(value, spec.min, spec.max, 0, 1, mapping);
  }
  
  switch (mapping) {
    case 'exp':
    case 'exponential': {
      const minLog = Math.log(Math.max(spec.min, 1e-10));
      const maxLog = Math.log(Math.max(spec.max, 1e-10));
      const valueLog = Math.log(Math.max(value, 1e-10));
      return (valueLog - minLog) / (maxLog - minLog);
    }
    
    case 'sin': {
      const range = spec.max - spec.min;
      const normalized = (value - spec.min) / range;
      return Math.asin(normalized * 2 - 1) / Math.PI + 0.5;
    }
    
    case 'cos': {
      const range = spec.max - spec.min;
      const normalized = (value - spec.min) / range;
      return Math.acos(1 - normalized * 2) / Math.PI;
    }
    
    case 'db': {
      const minAmp = dbToAmp(spec.min);
      const maxAmp = dbToAmp(spec.max);
      const valueAmp = dbToAmp(value);
      const range = maxAmp - minAmp;
      
      if (range > 0) {
        return Math.sqrt((valueAmp - minAmp) / range);
      } else {
        return 1 - Math.sqrt(1 - ((valueAmp - minAmp) / range));
      }
    }
    
    case 'lin':
    case 'linear':
    default:
      return (value - spec.min) / (spec.max - spec.min);
  }
}

// Denormalize value from [0, 1] to spec range
function denormalizeValue(normalized: number, spec: NumericSpec): number {
  const mapping = spec.mapping;
  
  if (typeof mapping === 'number') {
    // Numeric warp/curve value
    return lincurve(normalized, 0, 1, spec.min, spec.max, mapping);
  }
  
  switch (mapping) {
    case 'exp':
    case 'exponential': {
      const minLog = Math.log(Math.max(spec.min, 1e-10));
      const maxLog = Math.log(Math.max(spec.max, 1e-10));
      const valueLog = minLog + normalized * (maxLog - minLog);
      return Math.exp(valueLog);
    }
    
    case 'sin': {
      const angle = (normalized - 0.5) * Math.PI;
      const sinValue = (Math.sin(angle) + 1) / 2;
      return spec.min + sinValue * (spec.max - spec.min);
    }
    
    case 'cos': {
      const angle = normalized * Math.PI;
      const cosValue = (1 - Math.cos(angle)) / 2;
      return spec.min + cosValue * (spec.max - spec.min);
    }
    
    case 'db': {
      const minAmp = dbToAmp(spec.min);
      const maxAmp = dbToAmp(spec.max);
      const range = maxAmp - minAmp;
      
      let valueAmp: number;
      if (range > 0) {
        valueAmp = normalized * normalized * range + minAmp;
      } else {
        valueAmp = ((1 - Math.pow(1 - normalized, 2)) * range + minAmp);
      }
      
      return ampToDb(valueAmp);
    }
    
    case 'lin':
    case 'linear':
    default:
      return spec.min + normalized * (spec.max - spec.min);
  }
}

export type ControlSpec = NumericSpec | StringSpec | ActionSpec;

export interface Control {
  id: string;
  friendlyName?: string;
  spec: ControlSpec;
  value: number | string | boolean; // boolean for action toggle state
}

export interface Category {
  id: string;
  friendlyName?: string;
  controls: Control[];
}

export interface ControlPanelData {
  categories: Category[];
}

// Tree item for the VSCode tree view
export class ControlItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType: 'category' | 'control',
    public readonly categoryId?: string,
    public readonly controlId?: string,
    public readonly control?: Control
  ) {
    super(label, collapsibleState);

    if (itemType === 'control' && control) {
      this.contextValue = 'control';
      this.description = this.getControlDescription(control);

      // Set icon and styling based on control type
      if (control.spec.type === 'action') {
        this.iconPath = this.getActionIcon(control);
        this.contextValue = control.spec.enabled !== false ? 'action-enabled' : 'action-disabled';
      } else if (control.spec.type === 'numeric') {
        // Use custom slider icon based on value - this will be set by the provider
        this.iconPath = new vscode.ThemeIcon('symbol-number'); // Default fallback
      }
      // Don't set icon for string controls

      // For string controls that don't display property name, use the content as the label
      if (control.spec.type === 'string' && control.spec.displayPropertyName === false) {
        this.label = this.getStringContentForLabel(control.value as string);
        this.description = '';
      }

      // Add tooltip for string controls with full markdown content
      if (control.spec.type === 'string') {
        this.tooltip = new vscode.MarkdownString(control.value as string);
      }
    } else {
      this.contextValue = 'category';
      // Add a simple square icon for categories to make them stand out
      this.iconPath = new vscode.ThemeIcon('primitive-square', new vscode.ThemeColor('textLink.foreground'));
    }
  }

  private getControlDescription(control: Control): string {
    if (control.spec.type === 'numeric' && typeof control.value === 'number') {
      const spec = control.spec;
      const valueStr = control.value.toFixed(spec.decimals);
      const unitStr = spec.unit ? ` ${spec.unit}` : '';

      return `${valueStr}${unitStr}`;
    } else if (control.spec.type === 'string' && typeof control.value === 'string') {
      // Don't show description if displayPropertyName is false (content will be in label)
      if (control.spec.displayPropertyName === false) {
        return '';
      }

      // Strip markdown for display in tree item
      const plainText = control.value
        .replace(/\*\*(.*?)\*\*/g, '$1') // Bold
        .replace(/\*(.*?)\*/g, '$1') // Italic
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
        .replace(/`([^`]+)`/g, '$1') // Inline code
        .replace(/\n+/g, ' '); // Newlines to spaces

      // For strings, show first 30 chars
      return plainText.length > 30 ? plainText.substring(0, 30) + '...' : plainText;
    } else if (control.spec.type === 'action') {
      const spec = control.spec;

      if (spec.enabled === false) {
        return 'disabled';
      }

      if (spec.toggleable) {
        const isOn = control.value === true;
        return isOn ? 'on' : 'off';
      }

      return 'click to trigger';
    }
    return '';
  }

  private getActionIcon(control: Control): vscode.ThemeIcon {
    const spec = control.spec as ActionSpec;

    if (spec.enabled === false) {
      return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'));
    }

    if (spec.toggleable) {
      const isOn = control.value === true;
      const iconName = isOn ? (spec.iconOn || 'check') : (spec.iconOff || 'circle-large-outline');
      const colorName = isOn ? (spec.colorOn || 'terminal.ansiGreen') : (spec.colorOff || 'disabledForeground');
      return new vscode.ThemeIcon(iconName, new vscode.ThemeColor(colorName));
    }

    // Non-toggleable action
    const iconName = spec.iconOn || 'target';
    const colorName = spec.colorOn || 'button.foreground';
    return new vscode.ThemeIcon(iconName, new vscode.ThemeColor(colorName));
  }

  private getStringContentForLabel(value: string): string {
    // Strip markdown and get first line for label
    const plainText = value
      .replace(/\*\*(.*?)\*\*/g, '$1') // Bold
      .replace(/\*(.*?)\*/g, '$1') // Italic
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
      .replace(/`([^`]+)`/g, '$1') // Inline code
      .split('\n')[0]; // Take only first line

    // Limit length for tree display
    return plainText.length > 50 ? plainText.substring(0, 50) + '...' : plainText;
  }

  private getSliderIcon(value: number, spec: NumericSpec, extensionPath: vscode.Uri): vscode.Uri {
    // Normalize the value to 0..1 range
    let normalized: number;
    if (spec.mapping === 'exponential') {
      const minLog = Math.log(spec.min);
      const maxLog = Math.log(spec.max);
      const valueLog = Math.log(value);
      normalized = (valueLog - minLog) / (maxLog - minLog);
    } else {
      normalized = (value - spec.min) / (spec.max - spec.min);
    }

    // Clamp to 0..1
    normalized = Math.max(0, Math.min(1, normalized));

    // Convert to percentage for icon selection
    const percentage = normalized * 100;

    // Choose appropriate fill level icon
    let fillLevel: string;
    if (percentage <= 12.5) {
      fillLevel = 'fill-0';
    } else if (percentage <= 37.5) {
      fillLevel = 'fill-25';
    } else if (percentage <= 62.5) {
      fillLevel = 'fill-50';
    } else if (percentage <= 87.5) {
      fillLevel = 'fill-75';
    } else {
      fillLevel = 'fill-100';
    }

    return vscode.Uri.joinPath(extensionPath, 'images', 'slider', `${fillLevel}.svg`);
  }
}

export class ControlPanelProvider implements vscode.TreeDataProvider<ControlItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ControlItem | undefined | null | void> = new vscode.EventEmitter<ControlItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ControlItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private data: ControlPanelData;
  private values: Map<string, number | string | boolean> = new Map();
  private extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
    // Initialize with example data
    this.data = this.createExampleData();
    this.initializeValues();
  }

  private createExampleData(): ControlPanelData {
    return {
      categories: [
        {
          id: 'info',
          friendlyName: 'Information',
          controls: [
            {
              id: 'status',
              friendlyName: 'System Status',
              spec: {
                type: 'string',
                displayPropertyName: true
              },
              value: '**System Online**\n\nAll systems operational.'
            },
            {
              id: 'notes',
              friendlyName: 'Performance Notes',
              spec: {
                type: 'string',
                displayPropertyName: true
              },
              value: 'CPU usage is *normal*.'
            },
            {
              id: 'message',
              spec: {
                type: 'string',
                displayPropertyName: false
              },
              value: '🎵 **Welcome to SuperCollider!**\n\nThis is a multi-line message that shows directly as content without a property name.'
            },
            {
              id: 'help',
              spec: {
                type: 'string',
                displayPropertyName: false
              },
              value: 'Press `Cmd+.` to stop all sounds'
            }
          ]
        },
        {
          id: 'oscillators',
          friendlyName: 'Oscillators',
          controls: [
            {
              id: 'freq',
              friendlyName: 'Frequency',
              spec: {
                type: 'numeric',
                min: 20,
                max: 20000,
                step: 0,
                unit: 'Hz',
                mapping: 'exponential',
                decimals: 2
              },
              value: 440
            },
            {
              id: 'amp',
              friendlyName: 'Amplitude',
              spec: {
                type: 'numeric',
                min: 0,
                max: 1,
                step: 0.01,
                unit: '',
                mapping: 'linear',
                decimals: 3
              },
              value: 0.5
            }
          ]
        },
        {
          id: 'filters',
          friendlyName: 'Filters',
          controls: [
            {
              id: 'cutoff',
              friendlyName: 'Cutoff Frequency',
              spec: {
                type: 'numeric',
                min: 20,
                max: 20000,
                step: 0,
                unit: 'Hz',
                mapping: 'exponential',
                decimals: 1
              },
              value: 1000
            },
            {
              id: 'resonance',
              friendlyName: 'Resonance',
              spec: {
                type: 'numeric',
                min: 0.1,
                max: 30,
                step: 0.1,
                unit: '',
                mapping: 'exponential',
                decimals: 1
              },
              value: 1.0
            }
          ]
        },
        {
          id: 'actions',
          friendlyName: 'Actions',
          controls: [
            {
              id: 'record',
              friendlyName: 'Recording',
              spec: {
                type: 'action',
                toggleable: true,
                iconOn: 'record',
                iconOff: 'circle-large-outline',
                colorOn: 'terminal.ansiRed',
                colorOff: 'disabledForeground'
              },
              value: false
            },
            {
              id: 'mute',
              friendlyName: 'Mute',
              spec: {
                type: 'action',
                toggleable: true,
                iconOn: 'mute',
                iconOff: 'unmute',
                colorOn: 'terminal.ansiYellow',
                colorOff: 'terminal.ansiGreen'
              },
              value: false
            },
            {
              id: 'panic',
              friendlyName: 'Emergency Stop',
              spec: {
                type: 'action',
                toggleable: false,
                iconOn: 'stop-circle',
                colorOn: 'terminal.ansiRed'
              },
              value: false
            },
            {
              id: 'sync',
              friendlyName: 'Sync Clock',
              spec: {
                type: 'action',
                toggleable: false,
                iconOn: 'sync',
                colorOn: 'terminal.ansiBlue'
              },
              value: false
            },
            {
              id: 'disabled_action',
              friendlyName: 'Disabled Action',
              spec: {
                type: 'action',
                enabled: false,
                toggleable: true
              },
              value: false
            }
          ]
        }
      ]
    };
  }

  private initializeValues() {
    this.data.categories.forEach(category => {
      category.controls.forEach(control => {
        const key = `${category.id}.${control.id}`;
        this.values.set(key, control.value);
      });
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ControlItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ControlItem): Thenable<ControlItem[]> {
    if (!element) {
      // Return categories
      return Promise.resolve(
        this.data.categories.map(category =>
          new ControlItem(
            category.friendlyName || category.id,
            vscode.TreeItemCollapsibleState.Expanded,
            'category',
            category.id
          )
        )
      );
    } else if (element.itemType === 'category' && element.categoryId) {
      // Return controls for this category
      const category = this.data.categories.find(c => c.id === element.categoryId);
      if (category) {
        return Promise.resolve(
          category.controls.map(control => {
            // Get current value from our values map
            const key = `${category.id}.${control.id}`;
            const currentValue = this.values.get(key) ?? control.value;
            const controlWithValue = { ...control, value: currentValue };

            const controlItem = new ControlItem(
              control.friendlyName || control.id,
              vscode.TreeItemCollapsibleState.None,
              'control',
              category.id,
              control.id,
              controlWithValue
            );

            // Set custom slider icon for numeric controls
            if (controlWithValue.spec.type === 'numeric') {
              controlItem.iconPath = this.getSliderIconPath(controlWithValue.value as number, controlWithValue.spec as NumericSpec);
            }

            return controlItem;
          })
        );
      }
    }

    return Promise.resolve([]);
  }

  // Update the panel data from SuperCollider
  updatePanelData(data: ControlPanelData) {
    this.data = data;
    this.initializeValues();
    this.refresh();
  }

  // Update a single value
  updateValue(categoryId: string, controlId: string, value: number | string | boolean) {
    const key = `${categoryId}.${controlId}`;
    const oldValue = this.values.get(key);

    if (oldValue !== value) {
      this.values.set(key, value);
      console.log(`ControlPanel: Updated ${key} from ${oldValue} to ${value}`);
      this.refresh();
    }
  }

  // Get current value
  getValue(categoryId: string, controlId: string): number | string | boolean | undefined {
    const key = `${categoryId}.${controlId}`;
    return this.values.get(key);
  }

  // Handle value change from UI
  handleValueChange(categoryId: string, controlId: string, newValue: number | string | boolean, client?: any) {
    this.updateValue(categoryId, controlId, newValue);

    // Send notification to SuperCollider using new format
    console.log(`ControlPanel: Sending value change to SuperCollider - ${categoryId}.${controlId} = ${newValue}`);
    if (client) {
      client.sendNotification('supercollider/controlPanelChange', {
        category: categoryId,
        id: controlId,
        value: newValue
      });
    }
  }

  // Handle action trigger
  handleActionTrigger(categoryId: string, controlId: string, client?: any) {
    const control = this.getControl(categoryId, controlId);
    if (control && control.spec.type === 'action') {
      const spec = control.spec;

      if (spec.enabled === false) {
        return; // Don't trigger disabled actions
      }

      if (spec.toggleable) {
        // Toggle the state - use current value from values map
        const currentValue = this.getValue(categoryId, controlId) ?? control.value;
        const newValue = !currentValue;
        this.handleValueChange(categoryId, controlId, newValue, client);
      } else {
        // Send action trigger notification using new format
        console.log(`ControlPanel: Triggering action - ${categoryId}.${controlId}`);
        if (client) {
          client.sendNotification('supercollider/controlPanelChange', {
            category: categoryId,
            id: controlId,
            value: true // Actions send true when triggered
          });
        }
      }
    }
  }

  // Get control by path
  getControl(categoryId: string, controlId: string): Control | undefined {
    const category = this.data.categories.find(c => c.id === categoryId);
    if (category) {
      return category.controls.find(c => c.id === controlId);
    }
    return undefined;
  }

  // Get slider icon path based on value
  private getSliderIconPath(value: number, spec: NumericSpec): vscode.Uri {
    // Normalize the value to 0..1 range using the centralized function
    const normalized = Math.max(0, Math.min(1, normalizeValue(value, spec)));

    // Convert to percentage and round to nearest 10%
    const percentage = normalized * 100;
    const fillLevel = Math.round(percentage / 10) * 10;

    // Detect theme (light vs dark)
    const theme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? 'dark' : 'light';

    return vscode.Uri.joinPath(this.extensionUri, 'images', 'slider', theme, `fill-${fillLevel}.svg`);
  }
}

export class ControlDetailWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'supercolliderControlDetail';

  private _view?: vscode.WebviewView;
  private _currentControl?: Control;
  private _currentCategoryId?: string;
  private _currentControlId?: string;
  private _onValueChange?: (categoryId: string, controlId: string, value: number | string | boolean) => void;
  private _isDragging = false;

  constructor(private readonly _extensionContext: vscode.ExtensionContext) { }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionContext.extensionUri]
    };

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(message => {
      switch (message.command) {
        case 'valueChanged':
          if (this._currentCategoryId && this._currentControlId && this._onValueChange) {
            this._onValueChange(this._currentCategoryId, this._currentControlId, message.value);
          }
          break;
        case 'actionTriggered':
          if (this._currentCategoryId && this._currentControlId && this._onValueChange) {
            // For toggleable actions, toggle the value
            if (this._currentControl && this._currentControl.spec.type === 'action' && this._currentControl.spec.toggleable) {
              this._onValueChange(this._currentCategoryId, this._currentControlId, !this._currentControl.value);
            } else {
              // For non-toggleable actions, send a special trigger notification
              // This could be handled differently if needed
              console.log(`Action triggered: ${this._currentCategoryId}.${this._currentControlId}`);
            }
          }
          break;
        case 'dragStart':
          this._isDragging = true;
          console.log('Drag started - blocking server updates');
          break;
        case 'dragEnd':
          this._isDragging = false;
          console.log('Drag ended - re-enabling server updates');
          break;
      }
    });

    this.updateWebview();
  }

  public setValueChangeHandler(handler: (categoryId: string, controlId: string, value: number | string | boolean) => void) {
    this._onValueChange = handler;
  }

  public showControl(control: Control, categoryId: string, controlId: string) {
    this._currentControl = control;
    this._currentCategoryId = categoryId;
    this._currentControlId = controlId;

    if (this._view) {
      this.updateWebview(control, categoryId, controlId);
    }
  }

  public updateControlValue(value: number | string | boolean) {
    if (this._isDragging) {
      console.log(`Blocking server update during drag: ${value}`);
      return; // Block updates during drag
    }

    if (this._currentControl) {
      this._currentControl.value = value;
      this.updateWebview(this._currentControl, this._currentCategoryId, this._currentControlId);
    }
  }

  private updateWebview(control?: Control, categoryId?: string, controlId?: string) {
    if (!this._view) return;

    if (!control) {
      this._view.webview.html = this.getWelcomeHtml();
      return;
    }

    if (control.spec.type === 'string') {
      this._view.webview.html = this.getStringControlHtml(control);
    } else if (control.spec.type === 'numeric') {
      this._view.webview.html = this.getNumericControlHtml(control);
    } else if (control.spec.type === 'action') {
      this._view.webview.html = this.getActionControlHtml(control);
    }
  }

  private getWelcomeHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            padding: 20px;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            text-align: center;
        }
        .welcome {
            margin-top: 50px;
            opacity: 0.7;
        }
    </style>
</head>
<body>
    <div class="welcome">
        <h3>Control Detail View</h3>
        <p>Select a control from the tree to view details</p>
    </div>
</body>
</html>`;
  }

  private getStringControlHtml(control: Control): string {
    const value = control.value as string;
    const shouldShowName = control.spec.type === 'string' && control.spec.displayPropertyName !== false;

    // Convert markdown to HTML with better formatting
    let renderedHtml = value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');

    // Wrap in paragraphs if we have multiple lines
    if (renderedHtml.includes('</p><p>')) {
      renderedHtml = '<p>' + renderedHtml + '</p>';
    }

    return `<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            padding: 20px;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            line-height: 1.6;
        }
        .control-name {
            font-weight: bold;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-input-border);
            color: var(--vscode-textLink-foreground);
        }
        .content {
            font-size: 14px;
        }
        .content p {
            margin: 10px 0;
        }
        .content p:first-child {
            margin-top: 0;
        }
        .content p:last-child {
            margin-bottom: 0;
        }
        .content code {
            background-color: var(--vscode-textBlockQuote-background);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
        }
        .content strong {
            font-weight: 600;
        }
        .content em {
            font-style: italic;
        }
        .content a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }
        .content a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    ${shouldShowName ? `<div class="control-name">${control.friendlyName || control.id}</div>` : ''}
    <div class="content">${renderedHtml}</div>
</body>
</html>`;
  }

  private getNumericControlHtml(control: Control): string {
    const spec = control.spec as NumericSpec;
    const value = control.value as number;
    const normalizedValue = this.normalizeValue(value, spec);

    return `<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            padding: 20px;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        .control-name {
            font-weight: bold;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-input-border);
            color: var(--vscode-textLink-foreground);
        }
        .current-value {
            font-size: 24px;
            font-weight: bold;
            text-align: center;
            margin: 20px 0;
            padding: 15px;
            background-color: var(--vscode-input-background);
            border-radius: 6px;
            font-family: var(--vscode-editor-font-family);
            cursor: ns-resize;
            user-select: none;
        }
        .current-value:hover {
            background-color: var(--vscode-input-background);
            opacity: 0.9;
        }
        .slider-container {
            margin: 20px 0;
        }
        .slider {
            width: 100%;
            -webkit-appearance: none;
            height: 6px;
            border-radius: 3px;
            background: var(--vscode-input-background);
            outline: none;
            margin: 10px 0;
        }
        .slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: var(--vscode-button-background);
            cursor: pointer;
        }
        .slider::-moz-range-thumb {
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: var(--vscode-button-background);
            cursor: pointer;
            border: none;
        }
        .spec-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }
        .spec-table td {
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-input-border);
        }
        .spec-table td:first-child {
            font-weight: 500;
            color: var(--vscode-descriptionForeground);
            width: 30%;
        }
        .range-labels {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 5px;
        }
    </style>
</head>
<body>
    <div class="control-name">${control.friendlyName || control.id}</div>
    <div class="current-value" id="valueDisplay">${value.toFixed(spec.decimals)}${spec.unit ? ' ' + spec.unit : ''}</div>
    
    <div class="slider-container">
        <input type="range" class="slider" id="slider" 
               min="0" max="1000" value="${normalizedValue * 1000}" 
               step="${spec.step > 0 ? 1 : 'any'}">
        <div class="range-labels">
            <span>${spec.min}${spec.unit ? ' ' + spec.unit : ''}</span>
            <span>${spec.max}${spec.unit ? ' ' + spec.unit : ''}</span>
        </div>
    </div>
    
    <table class="spec-table">
        <tr><td>Range</td><td>${spec.min} - ${spec.max}</td></tr>
        <tr><td>Step</td><td>${spec.step > 0 ? spec.step : 'Continuous'}</td></tr>
        <tr><td>Mapping</td><td>${spec.mapping}</td></tr>
        <tr><td>Decimals</td><td>${spec.decimals}</td></tr>
        ${spec.unit ? `<tr><td>Unit</td><td>${spec.unit}</td></tr>` : ''}
    </table>
    
    <script>
        const vscode = acquireVsCodeApi();
        const slider = document.getElementById('slider');
        const valueDisplay = document.getElementById('valueDisplay');
        
        const spec = ${JSON.stringify(spec)};
        let currentValue = ${value};
        
        function normalizeValue(val) {
            const isExp = spec.mapping === '\\\\exp' || spec.mapping === '\\\\exponential' || spec.mapping === 'exponential';
            if (isExp) {
                const minLog = Math.log(spec.min);
                const maxLog = Math.log(spec.max);
                const valueLog = Math.log(val);
                return (valueLog - minLog) / (maxLog - minLog);
            } else {
                return (val - spec.min) / (spec.max - spec.min);
            }
        }
        
        function denormalizeValue(normalized) {
            const isExp = spec.mapping === '\\\\exp' || spec.mapping === '\\\\exponential' || spec.mapping === 'exponential';
            if (isExp) {
                const minLog = Math.log(spec.min);
                const maxLog = Math.log(spec.max);
                const valueLog = minLog + normalized * (maxLog - minLog);
                return Math.exp(valueLog);
            } else {
                return spec.min + normalized * (spec.max - spec.min);
            }
        }
        
        function updateValue(newValue) {
            if (spec.step > 0) {
                newValue = Math.round(newValue / spec.step) * spec.step;
            }
            
            currentValue = Math.max(spec.min, Math.min(spec.max, newValue));
            
            const normalized = normalizeValue(currentValue);
            slider.value = normalized * 1000;
            
            valueDisplay.textContent = currentValue.toFixed(spec.decimals) + 
                (spec.unit ? ' ' + spec.unit : '');
            
            vscode.postMessage({
                command: 'valueChanged',
                value: currentValue
            });
        }
        
        // Debounced slider updates to avoid server conflicts
        let sliderUpdateTimeout = null;
        
        slider.addEventListener('input', (e) => {
            const normalized = parseInt(e.target.value) / 1000;
            const newValue = denormalizeValue(normalized);
            
            // Update display immediately
            updateDisplayOnly(newValue);
            
            // Debounce server updates
            clearTimeout(sliderUpdateTimeout);
            sliderUpdateTimeout = setTimeout(() => {
                updateValue(currentValue);
            }, 100); // Send to server 100ms after last slider change
        });
        
        // Draggable value display - with live updates
        let isDragging = false;
        let lastY = 0;
        let dragStartTime = 0;
        let lastUpdateTime = 0;
        const THROTTLE_MS = 16; // ~60fps for live updates
        
        // Function to update display only (no server notification)
        function updateDisplayOnly(newValue) {
            if (spec.step > 0) {
                newValue = Math.round(newValue / spec.step) * spec.step;
            }
            
            currentValue = Math.max(spec.min, Math.min(spec.max, newValue));
            
            const normalized = normalizeValue(currentValue);
            slider.value = normalized * 1000;
            
            valueDisplay.textContent = currentValue.toFixed(spec.decimals) + 
                (spec.unit ? ' ' + spec.unit : '');
        }
        
        // Function to send live updates during drag (throttled)
        function sendLiveUpdate(newValue) {
            const now = Date.now();
            if (now - lastUpdateTime >= THROTTLE_MS) {
                lastUpdateTime = now;
                updateValue(newValue);
            }
        }
        
        valueDisplay.addEventListener('mousedown', (e) => {
            isDragging = true;
            lastY = e.clientY;
            dragStartTime = Date.now();
            lastUpdateTime = 0; // Reset throttle
            e.preventDefault();
            document.body.style.cursor = 'ns-resize';
            
            // Notify extension that we're starting a drag
            vscode.postMessage({
                command: 'dragStart'
            });
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const deltaY = lastY - e.clientY;
            lastY = e.clientY;
            
            // Work in normalized 0..1 space for consistent behavior across mappings
            const currentNormalized = normalizeValue(currentValue);
            
            // Base increment: 0.5% of normalized range per pixel
            let increment = 0.005;
            
            // Smaller increment when holding shift
            if (e.shiftKey) {
                increment = 0.001; // 0.1% when shift is held
            }
            
            const normalizedDelta = deltaY * increment;
            const newNormalized = Math.max(0, Math.min(1, currentNormalized + normalizedDelta));
            const newValue = denormalizeValue(newNormalized);
            
            updateDisplayOnly(newValue); // Update display immediately
            sendLiveUpdate(newValue); // Send throttled live updates
        });
        
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.cursor = '';
                
                // Send final value and notify drag end
                updateValue(currentValue);
                vscode.postMessage({
                    command: 'dragEnd'
                });
            }
        });
    </script>
</body>
</html>`;
  }

  private getActionControlHtml(control: Control): string {
    const spec = control.spec as ActionSpec;
    const isToggleable = spec.toggleable || false;
    const isOn = control.value === true;
    const isEnabled = spec.enabled !== false;

    let buttonText = control.friendlyName || control.id;
    let buttonClass = 'btn-primary';

    if (!isEnabled) {
      buttonText = `${buttonText} (Disabled)`;
      buttonClass = 'btn-disabled';
    } else if (isToggleable) {
      buttonText = `${buttonText} (${isOn ? 'ON' : 'OFF'})`;
      buttonClass = isOn ? 'btn-success' : 'btn-secondary';
    }

    return `<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            padding: 20px;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        .control-name {
            font-weight: bold;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-input-border);
            color: var(--vscode-textLink-foreground);
        }
        .action-button {
            width: 100%;
            padding: 15px 20px;
            margin: 20px 0;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            font-weight: 500;
            font-family: var(--vscode-font-family);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            transition: opacity 0.2s;
        }
        .action-button:hover:not(.btn-disabled) {
            opacity: 0.9;
        }
        .btn-primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-success {
            background-color: #28a745;
            color: white;
        }
        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-disabled {
            background-color: var(--vscode-input-background);
            color: var(--vscode-disabledForeground);
            cursor: not-allowed;
            opacity: 0.6;
        }
        .button-icon {
            font-size: 18px;
        }
        .action-info {
            margin-top: 20px;
            padding: 15px;
            background-color: var(--vscode-input-background);
            border-radius: 6px;
            font-size: 14px;
        }
        .info-row {
            display: flex;
            justify-content: space-between;
            margin: 5px 0;
        }
        .info-label {
            font-weight: 500;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="control-name">${control.friendlyName || control.id}</div>
    
    <button class="action-button ${buttonClass}" id="actionButton" ${!isEnabled ? 'disabled' : ''}>
        ${buttonText}
    </button>
    
    <div class="action-info">
        <div class="info-row">
            <span class="info-label">Type:</span>
            <span>${isToggleable ? 'Toggle Action' : 'Trigger Action'}</span>
        </div>
        <div class="info-row">
            <span class="info-label">Status:</span>
            <span>${isEnabled ? 'Enabled' : 'Disabled'}</span>
        </div>
        ${isToggleable ? `
        <div class="info-row">
            <span class="info-label">Current State:</span>
            <span>${isOn ? 'ON' : 'OFF'}</span>
        </div>
        ` : ''}
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        const actionButton = document.getElementById('actionButton');
        
        const isEnabled = ${isEnabled};
        
        if (isEnabled) {
            actionButton.addEventListener('click', () => {
                vscode.postMessage({
                    command: 'actionTriggered'
                });
            });
        }
    </script>
</body>
</html>`;
  }

  private normalizeValue(value: number, spec: NumericSpec): number {
    if (spec.mapping === 'exponential') {
      const minLog = Math.log(spec.min);
      const maxLog = Math.log(spec.max);
      const valueLog = Math.log(value);
      return (valueLog - minLog) / (maxLog - minLog);
    } else {
      // Linear mapping (default) - supports \lin, \linear, linear
      return (value - spec.min) / (spec.max - spec.min);
    }
  }
}

export class ControlPanel {
  private provider: ControlPanelProvider;
  private treeView: vscode.TreeView<ControlItem>;
  private client: any | null = null;
  private detailView: ControlDetailWebviewProvider;
  private currentSelectedCategory?: string;
  private currentSelectedControl?: string;

  constructor(context: vscode.ExtensionContext) {
    this.provider = new ControlPanelProvider(context.extensionUri);
    this.detailView = new ControlDetailWebviewProvider(context);

    this.treeView = vscode.window.createTreeView('supercolliderControls', {
      treeDataProvider: this.provider,
      showCollapseAll: true
    });

    // Register the tree view
    context.subscriptions.push(this.treeView);

    // Register the webview provider
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        ControlDetailWebviewProvider.viewType,
        this.detailView
      )
    );

    // Connect value change handler
    this.detailView.setValueChangeHandler((categoryId, controlId, value) => {
      this.provider.handleValueChange(categoryId, controlId, value, this.client);
      // Note: Detail view updates are now handled in updateValue method
    });

    // Register command to edit control values
    context.subscriptions.push(
      vscode.commands.registerCommand('supercollider.editControl', async (item: ControlItem) => {
        if (item.itemType === 'control' && item.categoryId && item.controlId && item.control) {
          await this.editControlValue(item.categoryId, item.controlId, item.control);
        }
      })
    );

    // Make tree items clickable - show in detail view only
    this.treeView.onDidChangeSelection(async e => {
      if (e.selection.length > 0) {
        const item = e.selection[0];
        if (item.itemType === 'control' && item.categoryId && item.controlId && item.control) {
          // Track current selection
          this.currentSelectedCategory = item.categoryId;
          this.currentSelectedControl = item.controlId;

          // Show in detail view
          this.detailView.showControl(item.control, item.categoryId, item.controlId);
        }
      } else {
        // Clear selection tracking
        this.currentSelectedCategory = undefined;
        this.currentSelectedControl = undefined;
      }
    });

    // Double-click to edit or trigger actions
    context.subscriptions.push(
      vscode.commands.registerCommand('supercollider.controls.doubleClick', async (item: ControlItem) => {
        if (item.itemType === 'control' && item.categoryId && item.controlId && item.control) {
          if (item.control.spec.type === 'action') {
            // Trigger action on double-click
            this.provider.handleActionTrigger(item.categoryId, item.controlId, this.client);
          } else {
            // Edit other control types
            await this.editControlValue(item.categoryId, item.controlId, item.control);
          }
        }
      })
    );

    // Inline action trigger button
    context.subscriptions.push(
      vscode.commands.registerCommand('supercollider.controls.triggerAction', (item: ControlItem) => {
        if (item.itemType === 'control' && item.categoryId && item.controlId && item.control && item.control.spec.type === 'action') {
          this.provider.handleActionTrigger(item.categoryId, item.controlId, this.client);
        }
      })
    );
  }

  private async editControlValue(categoryId: string, controlId: string, control: Control) {
    const currentValue = this.provider.getValue(categoryId, controlId) ?? control.value;

    if (control.spec.type === 'numeric' && typeof currentValue === 'number') {
      const spec = control.spec;
      const prompt = `${control.friendlyName || control.id} (${spec.min} - ${spec.max}${spec.unit ? ' ' + spec.unit : ''})`;

      const input = await vscode.window.showInputBox({
        prompt: prompt,
        value: currentValue.toFixed(spec.decimals),
        validateInput: (value) => {
          const num = parseFloat(value);
          if (isNaN(num)) {
            return 'Please enter a valid number';
          }
          if (num < spec.min || num > spec.max) {
            return `Value must be between ${spec.min} and ${spec.max}`;
          }
          return null;
        }
      });

      if (input !== undefined) {
        let newValue = parseFloat(input);
        if (spec.step > 0) {
          newValue = Math.round(newValue / spec.step) * spec.step;
        }
        this.provider.handleValueChange(categoryId, controlId, newValue, this.client);
      }
    } else if (control.spec.type === 'string') {
      // For string controls, show them in a preview
      const markdownString = new vscode.MarkdownString(currentValue as string);
      markdownString.isTrusted = true;

      await vscode.window.showInformationMessage(
        `${control.friendlyName || control.id}`,
        { modal: true, detail: currentValue as string }
      );
    }
  }

  updatePanelData(data: ControlPanelData) {
    this.provider.updatePanelData(data);

    // If we had a control selected, try to re-select it after spec update
    if (this.currentSelectedCategory && this.currentSelectedControl) {
      const control = this.provider.getControl(this.currentSelectedCategory, this.currentSelectedControl);
      if (control) {
        // Update the detail view with the new control data
        this.detailView.showControl(control, this.currentSelectedCategory, this.currentSelectedControl);
        console.log(`Re-connected detail view to ${this.currentSelectedCategory}.${this.currentSelectedControl} after spec update`);
      } else {
        // Control no longer exists, clear selection
        this.currentSelectedCategory = undefined;
        this.currentSelectedControl = undefined;
        console.log('Previously selected control no longer exists after spec update');
      }
    }
  }

  updateValue(categoryId: string, controlId: string, value: number | string | boolean) {
    this.provider.updateValue(categoryId, controlId, value);

    // If this is the currently selected control, update the detail view
    if (this.currentSelectedCategory === categoryId && this.currentSelectedControl === controlId) {
      this.detailView.updateControlValue(value);
    }
  }

  setClient(client: any) {
    this.client = client;
  }
}
