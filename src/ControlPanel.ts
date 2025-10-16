import * as vscode from "vscode";

// Interface definitions for control specifications
export interface NumericSpec {
  type: 'numeric';
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


export type ControlSpec = NumericSpec | StringSpec | ActionSpec;

export interface Control {
  id: string;
  friendlyName?: string;
  spec: ControlSpec;
  value: number | string | boolean; // boolean for action toggle state
  normalizedValue?: number; // For numeric controls: 0-1 normalized value
  displayValue?: string; // For numeric controls: formatted display string
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
    if (control.spec.type === 'numeric') {
      return control.displayValue || String(control.value);
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
                type: 'numeric'
              },
              value: 440,
              normalizedValue: 0.3,
              displayValue: '440.00 Hz'
            },
            {
              id: 'amp',
              friendlyName: 'Amplitude',
              spec: {
                type: 'numeric'
              },
              value: 0.5,
              normalizedValue: 0.5,
              displayValue: '0.500'
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
                type: 'numeric'
              },
              value: 1000,
              normalizedValue: 0.7,
              displayValue: '1000.0 Hz'
            },
            {
              id: 'resonance',
              friendlyName: 'Resonance',
              spec: {
                type: 'numeric'
              },
              value: 1.0,
              normalizedValue: 0.09,
              displayValue: '1.0'
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
              controlItem.iconPath = this.getSliderIconPath(controlWithValue);
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

  // Update a single value - for numeric controls, also update normalized/display values
  updateValue(categoryId: string, controlId: string, displayValue: string, normalizedValue?: number) {
    const key = `${categoryId}.${controlId}`;
    const oldValue = this.values.get(key);
    const control = this.getControl(categoryId, controlId);

    if (oldValue !== displayValue) {
      this.values.set(key, displayValue);

      // For numeric controls, also update normalized and display values
      if (control && control.spec.type === 'numeric') {
        if (normalizedValue !== undefined) {
          control.normalizedValue = normalizedValue;
        }
        if (displayValue !== undefined) {
          control.displayValue = displayValue;
        }
      }

      console.log(`ControlPanel: Updated ${key} from ${oldValue} to ${displayValue}`);
      this.refresh();
    }
  }

  // Get current value
  getValue(categoryId: string, controlId: string): number | string | boolean | undefined {
    const key = `${categoryId}.${controlId}`;
    return this.values.get(key);
  }

  // Handle value change from UI - expects normalized values for numeric controls
  handleValueChange(categoryId: string, controlId: string, newValue: number | string | boolean, client?: any) {
    const control = this.getControl(categoryId, controlId);

    if (control && control.spec.type === 'numeric') {
      // For numeric controls, newValue should be normalized (0-1)
      // Update the normalized value but keep the old display value until server responds
      control.normalizedValue = newValue as number;
    } else {
      // For string/action controls, update as before
      // this.updateValue(categoryId, controlId, newValue);
    }

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

  // Get slider icon path based on normalized value
  private getSliderIconPath(control: Control): vscode.Uri {
    // Use normalized value directly (0..1 range)
    const normalized = Math.max(0, Math.min(1, control.normalizedValue || 0));

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

  public updateControlValue(displayValue: string, normalizedValue?: number) {
    if (this._currentControl && this._currentControl.spec.type === 'numeric') {
      // Always update the control values
      this._currentControl.displayValue = displayValue;
      if (normalizedValue !== undefined) {
        this._currentControl.normalizedValue = normalizedValue;
      }

      // Update the webview with new values (unless dragging)
      // if (!this._isDragging) {
      //   this.updateWebview(this._currentControl, this._currentCategoryId, this._currentControlId);
      // } else {
      //   // During drag, only update the display value in the webview
      //   this._view?.webview.postMessage({
      //     command: 'updateDisplayOnly',
      //     displayValue: displayValue
      //   });
      // }
      this._view?.webview.postMessage({
        command: 'updateValue',
        displayValue: displayValue,
        normalizedValue: normalizedValue,
      });
    } else if (this._currentControl) {
      // For non-numeric controls
      this._currentControl.value = displayValue;
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
    const displayValue = control.displayValue || String(control.value);
    const normalizedValue = control.normalizedValue || 0;

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
    <div class="current-value" id="valueDisplay">${displayValue}</div>
    
    <div class="slider-container">
        <input type="range" class="slider" id="slider" 
               min="0" max="1000" value="${normalizedValue * 1000}" 
               step="1">
    </div>
    
    <div class="info">
        Drag value or slider to adjust. Control uses normalized values (0-1).
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        const slider = document.getElementById('slider');
        const valueDisplay = document.getElementById('valueDisplay');
        
        let currentNormalized = ${normalizedValue};
        let currentDisplay = "${displayValue}";
        
        function updateDisplay(newDisplay) {
            valueDisplay.textContent = newDisplay;
            currentDisplay = newDisplay;
        }
        
        function sendNormalizedValue(normalized) {
            vscode.postMessage({
                command: 'valueChanged',
                value: normalized
            });
        }
        
        // Slider updates - send normalized value directly
        let isSliderDragging = false;
        
        slider.addEventListener('mousedown', () => {
            isSliderDragging = true;
        });
        
        slider.addEventListener('mouseup', () => {
            isSliderDragging = false;
        });
        
        slider.addEventListener('input', (e) => {
            const normalized = parseInt(e.target.value) / 1000;
            // currentNormalized = normalized;
            // Don't update display - wait for server to tell us new display value
            sendNormalizedValue(normalized);
        });
        
        // Draggable value display - with live updates
        let isDragging = false;
        let dragStartNormalized = 0; // Store original value when drag starts
        let lastY = 0;
        let lastUpdateTime = 0;
        const THROTTLE_MS = 16; // ~60fps for live updates
        
        function sendLiveUpdate(normalized) {
            const now = Date.now();
            if (now - lastUpdateTime >= THROTTLE_MS) {
                lastUpdateTime = now;
                sendNormalizedValue(normalized);
            }
        }
        
        let dragStartY = 0;
        
        valueDisplay.addEventListener('mousedown', (e) => {
            isDragging = true;
            dragStartNormalized = currentNormalized; // Remember start point
            dragStartY = e.clientY; // Remember start Y position
            lastY = e.clientY;
            lastUpdateTime = 0; // Reset throttle
            e.preventDefault();
            document.body.style.cursor = 'ns-resize';
            
            // Notify extension that we're starting a drag
            vscode.postMessage({
                command: 'dragStart'
            });
        });
        
        function handleMouseMove(e) {
            if (!isDragging) return;
            
            // Calculate total movement from drag start
            const totalDeltaY = dragStartY - e.clientY; // Inverted: up = positive
            
            // Sensitivity: 0.5% change per pixel (adjustable)
            const sensitivity = e.shiftKey ? 0.001 : 0.005; // More precise with Shift
            const normalizedDelta = totalDeltaY * sensitivity;
            
            // Apply delta to the ORIGINAL start value (not current)
            const newNormalized = Math.max(0, Math.min(1, dragStartNormalized + normalizedDelta));
            currentNormalized = newNormalized;
            
            // Update slider position immediately
            slider.value = newNormalized * 1000;
            
            // Send live update (throttled)
            sendLiveUpdate(newNormalized);
        }
        
        function handleMouseUp() {
            if (isDragging) {
                isDragging = false;
                document.body.style.cursor = 'default';
                
                // Send final value
                sendNormalizedValue(currentNormalized);
                
                // Notify extension that we're ending a drag
                vscode.postMessage({
                    command: 'dragEnd'
                });
            }
        }
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        
        // Handle escape key to cancel drag
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isDragging) {
                handleMouseUp();
            }
        });
        
        // Scroll wheel support for value display (vertical scroll)
        valueDisplay.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            // Use deltaY for vertical scrolling
            const delta = -e.deltaY; // Invert so scroll up = increase value
            
            // Sensitivity: smaller than mouse drag
            const sensitivity = e.shiftKey ? 0.0002 : 0.001; // More precise with Shift
            const normalizedDelta = delta * sensitivity;
            
            // Apply delta to current normalized value
            const newNormalized = Math.max(0, Math.min(1, currentNormalized + normalizedDelta));
            currentNormalized = newNormalized;
            
            // Update slider position immediately
            slider.value = newNormalized * 1000;
            
            // Send update
            sendNormalizedValue(newNormalized);
        });
        
        // Scroll wheel support for slider (horizontal scroll if available)
        slider.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            // Try horizontal scroll first (deltaX), fallback to vertical (deltaY)
            const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? -e.deltaX : -e.deltaY;
            
            // Sensitivity: smaller than mouse drag
            const sensitivity = e.shiftKey ? 0.0002 : 0.001; // More precise with Shift
            const normalizedDelta = delta * sensitivity;
            
            // Apply delta to current normalized value
            const newNormalized = Math.max(0, Math.min(1, currentNormalized + normalizedDelta));
            currentNormalized = newNormalized;
            
            // Update slider position immediately
            slider.value = newNormalized * 1000;
            
            // Send update
            sendNormalizedValue(newNormalized);
        });
        
        // Listen for updates from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateValue') {
                // Only update values if not dragging (either value drag or slider drag)
                currentNormalized = message.normalizedValue;
                
                if (!isSliderDragging) {
                    slider.value = currentNormalized * 1000;
                }
                
                updateDisplay(message.displayValue);
            } else if (message.command === 'updateDisplayOnly') {
                // During drag: only update display value, don't change slider/normalized
                updateDisplay(message.displayValue);
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

    if (control.spec.type === 'numeric') {
      // For numeric controls, show a simple input for the display value
      const displayValue = control.displayValue || String(control.value);
      const prompt = `${control.friendlyName || control.id} (current: ${displayValue})`;

      const input = await vscode.window.showInputBox({
        prompt: prompt,
        value: displayValue,
        validateInput: (value) => {
          const num = parseFloat(value);
          if (isNaN(num)) {
            return 'Please enter a valid number';
          }
          return null;
        }
      });

      if (input !== undefined) {
        // For simplicity, we could map this input to a normalized value
        // But since we're keeping the panel "dumb", let's just show a message
        vscode.window.showInformationMessage(
          'Direct value editing not implemented. Use the slider or drag controls.'
        );
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

  updateValue(categoryId: string, controlId: string, displayValue: string, normalizedValue?: number) {
    this.provider.updateValue(categoryId, controlId, displayValue, normalizedValue);

    // If this is the currently selected control, update the detail view
    if (this.currentSelectedCategory === categoryId && this.currentSelectedControl === controlId) {
      this.detailView.updateControlValue(displayValue, normalizedValue);
    }
  }

  setClient(client: any) {
    this.client = client;
  }
}
