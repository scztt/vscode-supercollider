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
  path: string[]; // Path segments like ["audio", "oscillators", "freq"]
  friendlyName?: string;
  spec: ControlSpec;
  value: number | string | boolean; // boolean for action toggle state
  normalizedValue?: number; // For numeric controls: 0-1 normalized value
  displayValue?: string; // For numeric controls: formatted display string
}

export interface Category {
  id: string;
  friendlyName?: string;
  children: Map<string, Category>; // Nested categories
  controls: Control[]; // Controls directly in this category
}

export interface ControlPanelData {
  controls: Control[]; // Flat list of all controls
}

// Tree item for the VSCode tree view
export class ControlItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType: 'category' | 'control',
    public readonly path?: string[], // Full path for both categories and controls
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
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/`(.+?)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\n/g, ' ')
        .trim();

      // Truncate if too long
      return plainText.length > 50 ? plainText.substring(0, 47) + '...' : plainText;
    }
    return '';
  }

  private getStringContentForLabel(content: string): string {
    // Extract first line or meaningful content for label
    const lines = content.split('\n');
    let firstLine = lines[0] || '';

    // Remove markdown formatting
    firstLine = firstLine
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/#+\s*/, '')
      .trim();

    // Truncate if too long
    return firstLine.length > 30 ? firstLine.substring(0, 27) + '...' : firstLine;
  }

  private getActionIcon(control: Control): vscode.ThemeIcon {
    const spec = control.spec as ActionSpec;
    if (spec.toggleable && control.value) {
      return new vscode.ThemeIcon(spec.iconOn || 'circle-filled');
    } else {
      return new vscode.ThemeIcon(spec.iconOff || spec.iconOn || 'circle-outline');
    }
  }
}

export class ControlPanelProvider implements vscode.TreeDataProvider<ControlItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ControlItem | undefined | null | void> = new vscode.EventEmitter<ControlItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ControlItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private data: ControlPanelData;
  private values: Map<string, number | string | boolean> = new Map(); // Key is path.join('/')
  private rootCategories: Map<string, Category> = new Map();
  private extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
    // Initialize with example data
    this.data = this.createExampleData();
    this.buildCategoryTree();
    this.initializeValues();
  }

  // Helper function to convert path to key
  private pathToKey(path: string[]): string {
    return path.join('/');
  }

  // Helper function to convert key back to path
  private keyToPath(key: string): string[] {
    return key.split('/');
  }

  // Build nested category tree from flat controls list
  private buildCategoryTree() {
    this.rootCategories.clear();

    for (const control of this.data.controls) {
      if (control.path.length === 0) continue;

      let current = this.rootCategories;

      // Navigate/create path up to the control (all but last segment)
      for (let i = 0; i < control.path.length - 1; i++) {
        const segment = control.path[i];

        if (!current.has(segment)) {
          current.set(segment, {
            id: segment,
            friendlyName: segment.toUpperCase(),
            children: new Map(),
            controls: []
          });
        }

        current = current.get(segment)!.children;
      }

      // Controls are added directly to their parent category in getChildren()
      // No need to create a category for the control itself
    }
  }

  private createExampleData(): ControlPanelData {
    return {
      controls: [
        {
          path: ['info', 'status'],
          friendlyName: 'System Status',
          spec: {
            type: 'string',
            displayPropertyName: true
          },
          value: '**System Online**\n\nAll systems operational.'
        },
        {
          path: ['audio', 'oscillators', 'freq'],
          friendlyName: 'Frequency',
          spec: {
            type: 'numeric'
          },
          value: 440,
          normalizedValue: 0.3,
          displayValue: '440.00 Hz'
        },
        {
          path: ['actions', 'record'],
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
        }
      ]
    };
  }

  private initializeValues() {
    for (const control of this.data.controls) {
      const key = this.pathToKey(control.path);
      this.values.set(key, control.value);
    }
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  // Update the panel data from SuperCollider
  updatePanelData(data: ControlPanelData) {
    this.data = data;
    this.buildCategoryTree();
    this.initializeValues();
    this.refresh();
  }

  getTreeItem(element: ControlItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ControlItem): Thenable<ControlItem[]> {
    if (!element) {
      // Return root categories
      const items: ControlItem[] = [];

      for (const [key, category] of this.rootCategories) {
        items.push(new ControlItem(
          category.friendlyName || category.id,
          vscode.TreeItemCollapsibleState.Expanded,
          'category',
          [key]
        ));
      }

      return Promise.resolve(items);
    } else if (element.itemType === 'category' && element.path) {
      // Return children for this category path
      let current = this.rootCategories;

      // Navigate to the category
      for (const segment of element.path) {
        if (current.has(segment)) {
          current = current.get(segment)!.children;
        } else {
          return Promise.resolve([]);
        }
      }

      const items: ControlItem[] = [];

      // Add subcategories
      for (const [key, category] of current) {
        items.push(new ControlItem(
          category.friendlyName || category.id,
          vscode.TreeItemCollapsibleState.Expanded,
          'category',
          [...element.path, key]
        ));
      }

      // Add controls that match this path
      for (const control of this.data.controls) {
        if (control.path.length === element.path.length + 1 &&
          control.path.slice(0, -1).join('/') === element.path.join('/')) {

          // Get current value from our values map
          const key = this.pathToKey(control.path);
          const currentValue = this.values.get(key) ?? control.value;
          const controlWithValue = { ...control, value: currentValue };

          const controlItem = new ControlItem(
            control.friendlyName || control.path[control.path.length - 1],
            vscode.TreeItemCollapsibleState.None,
            'control',
            control.path,
            controlWithValue
          );

          // Set custom slider icon for numeric controls
          if (controlWithValue.spec.type === 'numeric') {
            controlItem.iconPath = this.getSliderIconPath(controlWithValue);
          }

          items.push(controlItem);
        }
      }

      return Promise.resolve(items);
    }

    return Promise.resolve([]);
  }

  // Update a single value - for numeric controls, also update normalized/display values
  updateValue(path: string[], displayValue: string, normalizedValue?: number) {
    const key = this.pathToKey(path);
    const oldValue = this.values.get(key);
    const control = this.getControl(path);

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
  getValue(path: string[]): number | string | boolean | undefined {
    const key = this.pathToKey(path);
    return this.values.get(key);
  }

  // Handle value change from UI - expects normalized values for numeric controls
  handleValueChange(path: string[], newValue: number | string | boolean, client?: any) {
    const control = this.getControl(path);

    if (control && control.spec.type === 'numeric') {
      // For numeric controls, newValue should be normalized (0-1)
      // Update the normalized value but keep the old display value until server responds
      control.normalizedValue = newValue as number;
    } else {
      // For string/action controls, update as before
      // this.updateValue(path, newValue);
    }

    // Send notification to SuperCollider using new format
    console.log(`ControlPanel: Sending value change to SuperCollider - ${this.pathToKey(path)} = ${newValue}`);
    if (client) {
      client.sendNotification('supercollider/controlPanelChange', {
        path: path,
        value: newValue
      });
    }
  }

  // Handle action trigger
  handleActionTrigger(path: string[], client?: any) {
    const control = this.getControl(path);
    if (control && control.spec.type === 'action') {
      const spec = control.spec;

      if (spec.enabled === false) {
        return; // Don't trigger disabled actions
      }

      if (spec.toggleable) {
        // Toggle the state - use current value from values map
        const currentValue = this.getValue(path) ?? control.value;
        const newValue = !currentValue;
        this.handleValueChange(path, newValue, client);
      } else {
        // Send action trigger notification using new format
        console.log(`ControlPanel: Triggering action - ${this.pathToKey(path)}`);
        if (client) {
          client.sendNotification('supercollider/controlPanelChange', {
            path: path,
            value: true // Actions send true when triggered
          });
        }
      }
    }
  }

  // Get control by path
  getControl(path: string[]): Control | undefined {
    const key = this.pathToKey(path);
    return this.data.controls.find(c => this.pathToKey(c.path) === key);
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
  private _currentPath?: string[];
  private _onValueChange?: (path: string[], value: number | string | boolean) => void;

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
          if (this._currentPath && this._onValueChange) {
            this._onValueChange(this._currentPath, message.value);
          }
          break;
        case 'actionTriggered':
          if (this._currentPath && this._onValueChange) {
            // For toggleable actions, toggle the value
            if (this._currentControl && this._currentControl.spec.type === 'action' && this._currentControl.spec.toggleable) {
              this._onValueChange(this._currentPath, !this._currentControl.value);
            } else {
              // For non-toggleable actions, send a special trigger notification
              console.log(`Action triggered: ${this._currentPath.join('/')}`);
            }
          }
          break;
        case 'dragStart':
          console.log('Drag started - blocking server updates');
          break;
        case 'dragEnd':
          console.log('Drag ended - re-enabling server updates');
          break;
      }
    });

    this.updateWebview();
  }

  public setValueChangeHandler(handler: (path: string[], value: number | string | boolean) => void) {
    this._onValueChange = handler;
  }

  public showControl(control: Control, path: string[]) {
    this._currentControl = control;
    this._currentPath = path;

    if (this._view) {
      this.updateWebview(control, path);
    }
  }

  public updateControlValue(displayValue: string, normalizedValue?: number) {
    if (this._currentControl && this._currentControl.spec.type === 'numeric') {
      // Always update the control values
      this._currentControl.displayValue = displayValue;
      if (normalizedValue !== undefined) {
        this._currentControl.normalizedValue = normalizedValue;
      }

      // Update the webview with new values
      this._view?.webview.postMessage({
        command: 'updateValue',
        displayValue: displayValue,
        normalizedValue: normalizedValue,
      });
    } else if (this._currentControl) {
      // For non-numeric controls
      this._currentControl.value = displayValue;
      this.updateWebview(this._currentControl, this._currentPath);
    }
  }

  private updateWebview(control?: Control, path?: string[]) {
    if (!this._view) return;

    if (!control) {
      this._view.webview.html = this.getEmptyHtml();
      return;
    }

    switch (control.spec.type) {
      case 'numeric':
        this._view.webview.html = this.getNumericControlHtml(control);
        break;
      case 'string':
        this._view.webview.html = this.getStringControlHtml(control);
        break;
      case 'action':
        this._view.webview.html = this.getActionControlHtml(control);
        break;
      default:
        this._view.webview.html = this.getEmptyHtml();
        break;
    }
  }

  private getEmptyHtml(): string {
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
            margin-top: 15px;
        }
        .content code {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
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
    ${shouldShowName ? `<div class="control-name">${control.friendlyName || control.path[control.path.length - 1]}</div>` : ''}
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
        .info {
            margin-top: 20px;
            padding: 10px;
            background-color: var(--vscode-input-background);
            border-radius: 4px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="control-name">${control.friendlyName || control.path[control.path.length - 1]}</div>
    <div class="current-value" id="valueDisplay">${displayValue}</div>
    
    <div class="slider-container">
        <input type="range" class="slider" id="slider" 
               min="0" max="1000" value="${normalizedValue * 1000}" 
               step="1">
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
            // Don't update display - wait for server to tell us new display value
            sendNormalizedValue(normalized);
        });
        
        // Draggable value display - with live updates
        let isDragging = false;
        let dragStartNormalized = 0; // Store original value when drag starts
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
                if (!isDragging && !isSliderDragging) {
                    currentNormalized = message.normalizedValue;
                    slider.value = currentNormalized * 1000;
                }
                
                // Always update display value
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

    let buttonText = control.friendlyName || control.path[control.path.length - 1];
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
            transition: all 0.2s ease;
        }
        .btn-primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .btn-success {
            background-color: var(--vscode-inputValidation-infoBackground);
            color: var(--vscode-inputValidation-infoForeground);
        }
        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .btn-disabled {
            background-color: var(--vscode-input-background);
            color: var(--vscode-disabledForeground);
            cursor: not-allowed;
            opacity: 0.6;
        }
        .action-info {
            margin-top: 15px;
            padding: 10px;
            background-color: var(--vscode-input-background);
            border-radius: 4px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="control-name">${control.friendlyName || control.path[control.path.length - 1]}</div>
    
    <button class="action-button ${buttonClass}" 
            ${isEnabled ? '' : 'disabled'} 
            onclick="triggerAction()">
        ${buttonText}
    </button>
    
    <div class="action-info">
        ${isToggleable ? 'Toggleable action - click to switch state' : 'Single-trigger action'}
        ${!isEnabled ? '<br><strong>This action is currently disabled</strong>' : ''}
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        function triggerAction() {
            ${isEnabled ? 'vscode.postMessage({ command: "actionTriggered" });' : ''}
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
  private currentSelectedPath?: string[];

  constructor(context: vscode.ExtensionContext) {
    this.provider = new ControlPanelProvider(context.extensionUri);
    this.detailView = new ControlDetailWebviewProvider(context);

    // Register the tree view
    this.treeView = vscode.window.createTreeView('supercolliderControls', {
      treeDataProvider: this.provider,
      showCollapseAll: true
    });

    // Register the webview provider
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(ControlDetailWebviewProvider.viewType, this.detailView)
    );

    // Set up value change handler
    this.detailView.setValueChangeHandler((path: string[], value: number | string | boolean) => {
      this.provider.handleValueChange(path, value, this.client);
    });

    // Handle tree selection changes
    this.treeView.onDidChangeSelection(e => {
      const selectedItem = e.selection[0];
      if (selectedItem && selectedItem.itemType === 'control' && selectedItem.control && selectedItem.path) {
        this.currentSelectedPath = selectedItem.path;
        this.detailView.showControl(selectedItem.control, selectedItem.path);
      }
    });

    // Handle double-click for editing
    context.subscriptions.push(vscode.commands.registerCommand('supercollider.controls.doubleClick',
      (item: ControlItem) => {
        if (item.control && item.path) {
          this.editControlValue(item.path, item.control);
        }
      }));

    // Handle action trigger from tree view
    context.subscriptions.push(vscode.commands.registerCommand('supercollider.controls.triggerAction',
      (item: ControlItem) => {
        if (item.control && item.path) {
          this.provider.handleActionTrigger(item.path, this.client);
        }
      }));

    context.subscriptions.push(this.treeView);
  }

  private async editControlValue(path: string[], control: Control) {
    const currentValue = this.provider.getValue(path) ?? control.value;

    if (control.spec.type === 'numeric') {
      // For numeric controls, show a simple input for the display value
      const displayValue = control.displayValue || String(control.value);
      const prompt = `${control.friendlyName || control.path[control.path.length - 1]} (current: ${displayValue})`;

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
        `${control.friendlyName || control.path[control.path.length - 1]}`,
        { modal: true, detail: currentValue as string }
      );
    }
  }

  updatePanelData(data: ControlPanelData) {
    this.provider.updatePanelData(data);

    // If we had a control selected, try to re-select it after spec update
    if (this.currentSelectedPath) {
      const control = this.provider.getControl(this.currentSelectedPath);
      if (control) {
        // Update the detail view with the new control data
        this.detailView.showControl(control, this.currentSelectedPath);
      } else {
        // Control no longer exists, clear selection
        this.currentSelectedPath = undefined;
        console.log('Previously selected control no longer exists after spec update');
      }
    }
  }

  updateValue(path: string[], displayValue: string, normalizedValue?: number) {
    this.provider.updateValue(path, displayValue, normalizedValue);

    // If this is the currently selected control, update the detail view
    if (this.currentSelectedPath && this.currentSelectedPath.join('/') === path.join('/')) {
      this.detailView.updateControlValue(displayValue, normalizedValue);
    }
  }

  setClient(client: any) {
    this.client = client;
  }
}