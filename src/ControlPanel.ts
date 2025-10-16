import * as vscode from "vscode";

// Interface definitions for control specifications
export interface NumericSpec {
  type: 'numeric';
  min: number;
  max: number;
  step: number; // 0 for no grid
  unit?: string; // e.g., "hz"
  mapping: 'linear' | 'exponential';
  decimals: number; // number of decimal places to display
}

export interface StringSpec {
  type: 'string';
  // String specs just display whatever string they are given
}

export type ControlSpec = NumericSpec | StringSpec;

export interface Control {
  id: string;
  friendlyName?: string;
  spec: ControlSpec;
  value: number | string;
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
      this.iconPath = new vscode.ThemeIcon(control.spec.type === 'numeric' ? 'symbol-number' : 'symbol-string');
      this.description = this.getControlDescription(control);
    } else {
      this.contextValue = 'category';
      this.iconPath = new vscode.ThemeIcon('folder');
    }
  }

  private getControlDescription(control: Control): string {
    if (control.spec.type === 'numeric' && typeof control.value === 'number') {
      const spec = control.spec;
      const valueStr = control.value.toFixed(spec.decimals);
      return spec.unit ? `${valueStr} ${spec.unit}` : valueStr;
    } else if (control.spec.type === 'string' && typeof control.value === 'string') {
      // For strings, show first 20 chars
      return control.value.length > 20 ? control.value.substring(0, 20) + '...' : control.value;
    }
    return '';
  }
}

export class ControlPanelProvider implements vscode.TreeDataProvider<ControlItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ControlItem | undefined | null | void> = new vscode.EventEmitter<ControlItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ControlItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private data: ControlPanelData;
  private values: Map<string, number | string> = new Map();

  constructor() {
    // Initialize with example data
    this.data = this.createExampleData();
    this.initializeValues();
  }

  private createExampleData(): ControlPanelData {
    return {
      categories: [
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
          id: 'info',
          friendlyName: 'Information',
          controls: [
            {
              id: 'status',
              friendlyName: 'System Status',
              spec: {
                type: 'string'
              },
              value: '**System Online**\n\nAll systems operational.'
            },
            {
              id: 'notes',
              friendlyName: 'Performance Notes',
              spec: {
                type: 'string'
              },
              value: 'CPU usage is *normal*.'
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
            
            return new ControlItem(
              control.friendlyName || control.id,
              vscode.TreeItemCollapsibleState.None,
              'control',
              category.id,
              control.id,
              controlWithValue
            );
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
  updateValue(categoryId: string, controlId: string, value: number | string) {
    const key = `${categoryId}.${controlId}`;
    const oldValue = this.values.get(key);
    
    if (oldValue !== value) {
      this.values.set(key, value);
      console.log(`ControlPanel: Updated ${key} from ${oldValue} to ${value}`);
      this.refresh();
    }
  }

  // Get current value
  getValue(categoryId: string, controlId: string): number | string | undefined {
    const key = `${categoryId}.${controlId}`;
    return this.values.get(key);
  }

  // Handle value change from UI
  handleValueChange(categoryId: string, controlId: string, newValue: number | string, client?: any) {
    this.updateValue(categoryId, controlId, newValue);
    
    // Send notification to SuperCollider
    console.log(`ControlPanel: Sending value change to SuperCollider - ${categoryId}.${controlId} = ${newValue}`);
    if (client) {
      client.sendNotification('supercollider/controlValueChanged', {
        categoryId,
        controlId,
        value: newValue
      });
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
}

export class ControlPanel {
  private provider: ControlPanelProvider;
  private treeView: vscode.TreeView<ControlItem>;
  private client: any | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.provider = new ControlPanelProvider();
    
    this.treeView = vscode.window.createTreeView('supercolliderControls', {
      treeDataProvider: this.provider,
      showCollapseAll: true
    });

    // Register the tree view
    context.subscriptions.push(this.treeView);

    // For now, we'll register a command to open control webviews
    // This will be replaced with inline controls later
    context.subscriptions.push(
      vscode.commands.registerCommand('supercollider.openControl', (item: ControlItem) => {
        if (item.itemType === 'control' && item.categoryId && item.controlId && item.control) {
          this.openControlWebview(context, item.categoryId, item.controlId, item.control);
        }
      })
    );

    // Make tree items clickable
    this.treeView.onDidChangeSelection(e => {
      if (e.selection.length > 0) {
        const item = e.selection[0];
        if (item.itemType === 'control' && item.categoryId && item.controlId && item.control) {
          vscode.commands.executeCommand('supercollider.openControl', item);
        }
      }
    });
  }

  private openControlWebview(context: vscode.ExtensionContext, categoryId: string, controlId: string, control: Control) {
    const panel = vscode.window.createWebviewPanel(
      'supercolliderControl',
      control.friendlyName || control.id,
      vscode.ViewColumn.Two,
      {
        enableScripts: true
      }
    );

    const currentValue = this.provider.getValue(categoryId, controlId) ?? control.value;
    
    if (control.spec.type === 'numeric') {
      panel.webview.html = this.getNumericControlHtml(control, currentValue as number);
      
      // Handle messages from the webview
      panel.webview.onDidReceiveMessage(
        message => {
          switch (message.command) {
            case 'valueChanged':
              this.provider.handleValueChange(categoryId, controlId, message.value, this.client);
              break;
          }
        },
        undefined,
        context.subscriptions
      );
    } else if (control.spec.type === 'string') {
      panel.webview.html = this.getStringControlHtml(control, currentValue as string);
    }
  }

  private getNumericControlHtml(control: Control, value: number): string {
    if (control.spec.type !== 'numeric') return '';
    
    const spec = control.spec;
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
        .control-container {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .slider-container {
            display: flex;
            align-items: center;
            gap: 15px;
        }
        .slider {
            flex: 1;
            -webkit-appearance: none;
            height: 6px;
            border-radius: 3px;
            background: var(--vscode-input-background);
            outline: none;
        }
        .slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: var(--vscode-button-background);
            cursor: pointer;
        }
        .value-display {
            min-width: 100px;
            text-align: right;
            font-family: var(--vscode-editor-font-family);
            cursor: ns-resize;
            user-select: none;
            padding: 5px 10px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
        }
        .value-display:hover {
            background-color: var(--vscode-input-background);
        }
        .label {
            font-weight: bold;
            margin-bottom: 5px;
        }
    </style>
</head>
<body>
    <div class="control-container">
        <div class="label">${control.friendlyName || control.id}</div>
        <div class="slider-container">
            <input 
                type="range" 
                class="slider" 
                id="slider" 
                min="0" 
                max="1000" 
                value="${normalizedValue * 1000}"
                step="${spec.step > 0 ? 1 : 'any'}"
            >
            <div class="value-display" id="valueDisplay">
                ${value.toFixed(spec.decimals)}${spec.unit ? ' ' + spec.unit : ''}
            </div>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        const slider = document.getElementById('slider');
        const valueDisplay = document.getElementById('valueDisplay');
        
        const spec = ${JSON.stringify(spec)};
        let currentValue = ${value};
        
        function normalizeValue(val) {
            if (spec.mapping === 'exponential') {
                const minLog = Math.log(spec.min);
                const maxLog = Math.log(spec.max);
                const valueLog = Math.log(val);
                return (valueLog - minLog) / (maxLog - minLog);
            } else {
                return (val - spec.min) / (spec.max - spec.min);
            }
        }
        
        function denormalizeValue(normalized) {
            if (spec.mapping === 'exponential') {
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
        
        slider.addEventListener('input', (e) => {
            const normalized = parseInt(e.target.value) / 1000;
            const newValue = denormalizeValue(normalized);
            updateValue(newValue);
        });
        
        // Draggable value display
        let isDragging = false;
        let startY = 0;
        let startValue = 0;
        
        valueDisplay.addEventListener('mousedown', (e) => {
            isDragging = true;
            startY = e.clientY;
            startValue = currentValue;
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const deltaY = startY - e.clientY;
            const range = spec.max - spec.min;
            const sensitivity = spec.step > 0 ? spec.step : range * 0.01;
            const delta = deltaY * sensitivity;
            
            updateValue(startValue + delta);
        });
        
        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    </script>
</body>
</html>`;
  }

  private getStringControlHtml(control: Control, value: string): string {
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
        .label {
            font-weight: bold;
            margin-bottom: 10px;
        }
        .content {
            padding: 10px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            background-color: var(--vscode-input-background);
        }
    </style>
</head>
<body>
    <div class="label">${control.friendlyName || control.id}</div>
    <div class="content">${value}</div>
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
      return (value - spec.min) / (spec.max - spec.min);
    }
  }

  updatePanelData(data: ControlPanelData) {
    this.provider.updatePanelData(data);
  }

  updateValue(categoryId: string, controlId: string, value: number | string) {
    this.provider.updateValue(categoryId, controlId, value);
  }
  
  setClient(client: any) {
    this.client = client;
  }
}