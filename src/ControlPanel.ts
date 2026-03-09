import * as vscode from "vscode";
import { marked, Tokens } from 'marked';

// Interface definitions for control specifications
export interface NumericSpec {
  type: 'numeric';
  displayName?: string; // Optional display name for the control
}

export interface StringSpec {
  type: 'string';
  displayName?: string; // Optional display name for the control
  displayPropertyName?: boolean; // Whether to show the property name (default: true)
}

export interface ActionSpec {
  type: 'action';
  displayName?: string; // Optional display name for the control
  enabled?: boolean; // Whether the action can be triggered (default: true)
  toggleable?: boolean; // Whether this is a toggle action (default: false)
  description?: string; // Description text
}

export interface PopupSpec {
  type: 'popup';
  displayName?: string; // Optional display name for the control
  items: string[]; // List of items to show in the popup
}

export type ControlSpec = NumericSpec | StringSpec | ActionSpec | PopupSpec;

export interface Control {
  path: string[]; // Path segments like ["audio", "oscillators", "freq"]
  spec: ControlSpec;
  value: number | string | boolean; // boolean for action toggle state
  normalizedValue?: number; // For numeric controls: 0-1 normalized value
  displayValue?: string; // For numeric controls: formatted display string
  order?: number; // Order this control was encountered in the list
}

export interface Category {
  id: string;
  displayName?: string;
  children: Map<string, Category>; // Nested categories
  controls: Control[]; // Controls directly in this category
  order: number; // Order this category was first encountered
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
      } else if (control.spec.type === 'popup') {
        this.iconPath = new vscode.ThemeIcon('list-selection');
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
    } else if (control.spec.type === 'popup') {
      return String(control.value || '');
    } else if (control.spec.type === 'string' && typeof control.value === 'string') {
      // Don't show description if displayPropertyName is false (content will be in label)
      if (control.spec.displayPropertyName === false) {
        return '';
      }

      // Use marked to strip markdown for display in tree item
      let plainText: string;
      try {
        plainText = this.markdownToPlainText(control.value);
      } catch (error) {
        console.warn('Failed to strip markdown, falling back to manual stripping:', error);
        // Fallback to manual stripping
        plainText = control.value
          .replace(/\*\*(.+?)\*\*/g, '$1')
          .replace(/\*(.+?)\*/g, '$1')
          .replace(/`(.+?)`/g, '$1')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/\n/g, ' ')
          .trim();
      }

      // Truncate if too long
      return plainText.length > 50 ? plainText.substring(0, 47) + '...' : plainText;
    }
    return '';
  }

  private markdownToPlainText(markdown: string): string {
    // Create a custom renderer that strips all formatting and returns plain text
    class PlainTextRenderer extends marked.Renderer {
      heading = ({ text }: Tokens.Heading): string => text + '\n';
      paragraph = ({ tokens }: Tokens.Paragraph): string => this.parser.parseInline(tokens) + '\n\n';
      strong = ({ tokens }: Tokens.Strong): string => this.parser.parseInline(tokens);
      em = ({ tokens }: Tokens.Em): string => this.parser.parseInline(tokens);
      codespan = ({ text }: Tokens.Codespan): string => text;
      code = ({ text }: Tokens.Code): string => text + '\n\n';
      link = ({ tokens }: Tokens.Link): string => this.parser.parseInline(tokens);
      image = ({ text }: Tokens.Image): string => text || '';
      br = (): string => '\n';
      hr = (): string => '\n';
      blockquote = ({ tokens }: Tokens.Blockquote): string => this.parser.parseInline(tokens);
      list = ({ items }: Tokens.List): string => items.map(item => this.listitem(item)).join('');
      listitem = ({ tokens }: Tokens.ListItem): string => '- ' + this.parser.parseInline(tokens) + '\n';
      del = ({ tokens }: Tokens.Del): string => this.parser.parseInline(tokens);
      html = (): string => '';
    }

    const renderer = new PlainTextRenderer();
    const result = marked.parse(markdown, { renderer, async: false }) as string;
    return result.replace(/\n+/g, ' ').trim();
  }

  private getStringContentForLabel(content: string): string {
    // Extract first line or meaningful content for label
    const lines = content.split('\n');
    let firstLine = '';
    for (let line of lines) {
      if (line.trim().length > 0) {
        firstLine = line.trim();
        break;
      }
    }
    return this.markdownToPlainText(firstLine);
  }

  private getActionIcon(control: Control): vscode.ThemeIcon {
    const spec = control.spec as ActionSpec;
    if (spec.toggleable) {
      console.log(`Action icon for ${control.path.join('/')}: value=${control.value}, normalizedValue=${control.normalizedValue}`);
      return new vscode.ThemeIcon(control.value ? 'pass-filled' : 'circle-large-outline');
    } else {
      return new vscode.ThemeIcon('play');
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
  private recentlyModified: Map<string, number> = new Map(); // Key is path.join('/'), value is timestamp
  private badgeCleanupInterval: NodeJS.Timer | undefined;
  private readonly BADGE_DURATION_MS = 5 * 1000;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
    // Initialize with example data
    this.data = { controls: [] };
    this.buildCategoryTree();
    this.initializeValues();

    // Start badge cleanup interval
    this.startBadgeCleanup();
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
    let orderCounter = 0;

    // First pass: assign order to all controls and create categories
    for (let i = 0; i < this.data.controls.length; i++) {
      const control = this.data.controls[i];
      if (control.path.length === 0) continue;

      // Assign order to the control
      control.order = orderCounter++;

      let current = this.rootCategories;

      // Navigate/create path up to the control (all but last segment)
      for (let j = 0; j < control.path.length - 1; j++) {
        const segment = control.path[j];

        if (!current.has(segment)) {
          current.set(segment, {
            id: segment,
            displayName: segment.toUpperCase(),
            children: new Map(),
            controls: [],
            order: orderCounter++
          });
        }

        current = current.get(segment)!.children;
      }
    }
  }

  private createExampleData(): ControlPanelData {
    return {
      controls: [
        {
          path: ['info', 'status'],
          spec: {
            displayName: 'System Status',
            type: 'string',
            displayPropertyName: true
          },
          value: '**System Online**\n\nAll systems operational.'
        },
        {
          path: ['audio', 'oscillators', 'freq'],
          spec: {
            displayName: 'Frequency',
            type: 'numeric'
          },
          value: 440,
          normalizedValue: 0.3,
          displayValue: '440.00 Hz'
        },
        {
          path: ['actions', 'record'],
          spec: {
            displayName: 'Recording',
            type: 'action',
            toggleable: true,
            description: 'Toggle recording'
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
      // Return root categories sorted by order
      const items: ControlItem[] = [];

      const sortedRootCategories = Array.from(this.rootCategories.entries())
        .sort(([, a], [, b]) => a.order - b.order);

      for (const [key, category] of sortedRootCategories) {
        items.push(new ControlItem(
          category.displayName || category.id,
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

      // Collect all items (categories and controls) with their orders
      const allItems: Array<{ item: ControlItem, order: number }> = [];

      // Add subcategories
      for (const [key, category] of current.entries()) {
        allItems.push({
          item: new ControlItem(
            category.displayName || category.id,
            vscode.TreeItemCollapsibleState.Expanded,
            'category',
            [...element.path, key]
          ),
          order: category.order
        });
      }

      // Add controls that match this path
      for (const control of this.data.controls) {
        if (control.path.length === element.path.length + 1 &&
          control.path.slice(0, -1).join('/') === element.path.join('/')) {

          // Use the control directly - it already has updated values from updateValue()
          const controlWithValue = control;

          const controlItem = new ControlItem(
            control.spec.displayName || control.path[control.path.length - 1],
            vscode.TreeItemCollapsibleState.None,
            'control',
            control.path,
            controlWithValue
          );

          // Set custom slider icon for numeric controls
          if (controlWithValue.spec.type === 'numeric') {
            controlItem.iconPath = this.getSliderIconPath(controlWithValue);
          }

          // Add badge if recently modified
          if (this.isRecentlyModified(control.path)) {
            controlItem.description = `${controlItem.description || ''} ●`.trim();
          }

          allItems.push({
            item: controlItem,
            order: control.order ?? 999999 // Fallback for controls without order
          });
        }
      }

      // Sort all items by order and extract the items
      allItems.sort((a, b) => a.order - b.order);
      items.push(...allItems.map(x => x.item));

      return Promise.resolve(items);
    }

    return Promise.resolve([]);
  }

  // Update a single value - for numeric controls, also update normalized/display values
  updateValue(path: string[], displayValue: string, normalizedValue?: number) {
    const key = this.pathToKey(path);
    const oldValue = this.values.get(key);
    const control = this.getControl(path);

    this.values.set(key, displayValue);

    // Mark as recently modified with timestamp
    this.recentlyModified.set(key, Date.now());

    if (control) {
      // Update all values consistently for all control types
      control.displayValue = displayValue;
      if (normalizedValue !== undefined) {
        control.normalizedValue = normalizedValue;
      }

      // Update the value based on control type
      if (control.spec.type === 'numeric') {
        control.value = normalizedValue ?? 0;
      } else if (control.spec.type === 'action') {
        const oldValue = control.value;
        control.value = normalizedValue !== undefined ? normalizedValue !== 0 : false;
        console.log(`Action value update for ${control.path.join('/')}: ${oldValue} -> ${control.value} (normalized: ${normalizedValue})`);
      } else {
        // String and popup controls use displayValue as their value
        control.value = displayValue;
      }
    }

    console.log(`ControlPanel: Updated ${key} from ${oldValue} to ${displayValue}`);
    // Refresh immediately to show the badge
    this.refresh();
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
      client.sendNotification('supercollider/controlPanelSetNormalized', {
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

      // Always send action trigger message - server will handle toggle state if needed
      console.log(`ControlPanel: Triggering action - ${this.pathToKey(path)}`);
      if (client) {
        if (spec.toggleable) {
          client.sendNotification('supercollider/controlPanelSetNormalized', {
            path: path,
            value: control.normalizedValue == 0 ? 1 : 0
          });
        } else {
          client.sendNotification('supercollider/controlPanelSetNormalized', {
            path: path,
            value: 1
          });
          client.sendNotification('supercollider/controlPanelSetNormalized', {
            path: path,
            value: 0
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

  // Check if a control was recently modified
  private isRecentlyModified(path: string[]): boolean {
    const key = this.pathToKey(path);
    return this.recentlyModified.has(key);
  }

  // Start the badge cleanup interval
  private startBadgeCleanup() {
    // Clear any existing interval
    if (this.badgeCleanupInterval) {
      clearInterval(this.badgeCleanupInterval);
    }

    // Run cleanup every second
    this.badgeCleanupInterval = setInterval(() => {
      const now = Date.now();
      let needsRefresh = false;

      // Check each recently modified item
      for (const [key, timestamp] of this.recentlyModified) {
        if (now - timestamp > this.BADGE_DURATION_MS) {
          // Remove items older than BADGE_DURATION_MS
          this.recentlyModified.delete(key);
          needsRefresh = true;
        }
      }

      // Only refresh if we removed any badges
      if (needsRefresh) {
        this.refresh();
      }
    }, 1000); // Check every second
  }

  // Clean up when provider is disposed
  dispose() {
    if (this.badgeCleanupInterval) {
      clearInterval(this.badgeCleanupInterval);
      this.badgeCleanupInterval = undefined;
    }
  }
}

export class ControlDetailWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'supercolliderControlDetail';

  private _view?: vscode.WebviewView;
  private _currentControl?: Control;
  private _currentPath?: string[];
  private _selectedControls: Array<{ control: Control, path: string[] }> = [];
  private _onValueChange?: (path: string[], value: number | string | boolean) => void;
  private _onActionTrigger?: (path: string[]) => void;

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
          if (this._onValueChange) {
            // Use path from message if provided, otherwise fall back to current path
            const pathToUse = message.path || this._currentPath;
            if (pathToUse) {
              this._onValueChange(pathToUse, message.value);
            }
          }
          break;
        case 'actionTriggered':
          if (this._onActionTrigger) {
            const pathToUse = message.path || this._currentPath;
            if (pathToUse) {
              this._onActionTrigger(pathToUse);
            }
          }
          break;
        case 'showPopupList':
          this.showPopupDialog(message.items, message.current, message.path);
          break;
        case 'dragStart':
          console.log('Drag started - blocking server updates');
          break;
        case 'dragEnd':
          console.log('Drag ended - re-enabling server updates');
          break;
      }
    });

    this.updateWebviewForMultiple();
  }

  public setValueChangeHandler(handler: (path: string[], value: number | string | boolean) => void) {
    this._onValueChange = handler;
  }

  public setActionTriggerHandler(handler: (path: string[]) => void) {
    this._onActionTrigger = handler;
  }

  public showControl(control: Control, path: string[]) {
    this._currentControl = control;
    this._currentPath = path;
    this._selectedControls = [{ control, path }];

    if (this._view) {
      this.updateWebviewForMultiple();
    }
  }

  public showControls(controls: Array<{ control: Control, path: string[] }>) {
    this._selectedControls = controls;

    // For single selection, maintain backward compatibility
    if (controls.length === 1) {
      this._currentControl = controls[0].control;
      this._currentPath = controls[0].path;
    } else {
      this._currentControl = undefined;
      this._currentPath = undefined;
    }

    if (this._view) {
      this.updateWebviewForMultiple();
    }
  }

  public updateControlValue(displayValue: string, normalizedValue?: number) {
    if (this._currentControl && this._currentPath) {
      // Use the unified update method for consistency
      this.updateControlValueByPath(this._currentPath, displayValue, normalizedValue);
    }
  }

  public updateControlValueByPath(path: string[], displayValue: string, normalizedValue?: number) {
    // Find the control in our selected controls
    const controlIndex = this._selectedControls.findIndex(c =>
      c.path.join('/') === path.join('/')
    );

    if (controlIndex !== -1) {
      const controlData = this._selectedControls[controlIndex];

      // Update the control data - same semantics for all control types
      controlData.control.displayValue = displayValue;
      if (normalizedValue !== undefined) {
        controlData.control.normalizedValue = normalizedValue;
      }

      // Update the value based on control type
      if (controlData.control.spec.type === 'numeric') {
        controlData.control.value = normalizedValue ?? 0;
      } else if (controlData.control.spec.type === 'action') {
        controlData.control.value = normalizedValue !== undefined ? normalizedValue !== 0 : false;
      } else {
        // String and popup controls use displayValue as their value
        controlData.control.value = displayValue;
      }

      // Send update message to webview
      this._view?.webview.postMessage({
        command: 'updateValue',
        path: path,
        displayValue: displayValue,
        normalizedValue: normalizedValue,
        value: controlData.control.value
      });
    }
  }


  private updateWebviewForMultiple() {
    if (!this._view) return;

    if (this._selectedControls.length === 0) {
      this._view.webview.html = this.getEmptyHtml();
      return;
    }

    // Always use the new multi-control display (even for single selection)
    this._view.webview.html = this.getMultipleControlsHtml(this._selectedControls);
  }

  public async showPopupDialog(items: string[], current: string, path?: string[]) {
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Select value (current: ${current})`,
      canPickMany: false
    });

    if (selected && this._onValueChange) {
      const pathToUse = path || this._currentPath;
      if (pathToUse) {
        // Calculate normalized value based on position in list
        const selectedIndex = items.indexOf(selected);
        const normalizedValue = items.length > 1 ? selectedIndex / (items.length - 1) : 0;

        console.log(`Popup selection: "${selected}" at index ${selectedIndex} of ${items.length} items, normalized: ${normalizedValue}`);

        // Send normalized value to server, let server handle the display value update
        this._onValueChange(pathToUse, normalizedValue);
      }
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

    // Use marked library for markdown rendering
    let renderedHtml: string;
    try {
      renderedHtml = marked.parse(value) as string;
    } catch (error) {
      console.warn('Failed to render markdown, falling back to plain text:', error);
      // Fallback to basic HTML escaping if markdown rendering fails
      renderedHtml = value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
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
            line-height: 1.4;
            overflow: overlay;
        }
        
        /* Scale down for smaller panels */
        @media (max-width: 400px) {
            body { padding: 12px; font-size: 13px; }
            .control-path { font-size: 12px; margin-bottom: 6px; padding-bottom: 4px; }
            .content { margin-top: 8px; }
        }
        
        @media (max-width: 300px) {
            body { padding: 8px; font-size: 12px; }
            .control-path { font-size: 11px; margin-bottom: 4px; padding-bottom: 3px; }
            .content { margin-top: 6px; }
        }
        .control-path {
            margin-bottom: 10px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-input-border);
            font-size: 14px;
            line-height: 1.2;
        }
        .path-segment {
            color: var(--vscode-foreground);
        }
        .path-separator {
            color: var(--vscode-descriptionForeground);
            margin: 0 6px;
        }
        .path-name {
            font-weight: bold;
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
    ${shouldShowName ? this.getControlPathHtml(control) : ''}
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
            overflow: hidden;
        }
        
        /* Scale down for smaller panels */
        @media (max-width: 400px) {
            body { padding: 12px; font-size: 13px; }
            .control-path { font-size: 12px; margin-bottom: 6px; padding-bottom: 4px; }
            .current-value { font-size: 20px; margin: 8px 0; padding: 8px; }
            .slider-container { margin: 8px 0; }
            .custom-slider { height: 45px; }
            .info { margin-top: 8px; padding: 6px; font-size: 11px; }
        }
        
        @media (max-width: 300px) {
            body { padding: 8px; font-size: 12px; }
            .control-path { font-size: 11px; margin-bottom: 4px; padding-bottom: 3px; }
            .current-value { font-size: 18px; margin: 6px 0; padding: 6px; }
            .slider-container { margin: 6px 0; }
            .custom-slider { height: 35px; }
            .info { margin-top: 6px; padding: 5px; font-size: 10px; }
        }
        .control-path {
            margin-bottom: 10px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-input-border);
            font-size: 14px;
            line-height: 1.2;
            font-variant: small-caps;
        }
        .path-segment {
            color: var(--vscode-foreground);
        }
        .path-separator {
            color: var(--vscode-descriptionForeground);
            margin: 0 6px;
        }
        .path-name {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        .current-value {
            font-size: 18px;
            font-weight: bold;
            text-align: center;
            margin: 2px 0;
            padding: 2px;
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
            margin: 4px 0;
            position: relative;
        }
        .custom-slider {
            width: 100%;
            height: 26px;
            position: relative;
            cursor: ew-resize;
            margin: 10px 0;
        }
        .slider-track {
            width: 100%;
            height: 100%;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            position: absolute;
            top: 16px;
            transform: translateY(-50%);
        }
        .slider-fill {
            height: 100%;
            background: var(--vscode-button-background);
            border-radius: 2px;
        }
        .slider-overlay {
            position: absolute;
            width: 100%;
            height: 100%;
            top: 0;
            left: 0;
            cursor: ew-resize;
        }
        .slider-value-overlay {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-weight: bold;
            font-size: 14px;
            color: var(--vscode-foreground);
            pointer-events: none;
            z-index: 3;
            background-color: var(--vscode-editor-background);
            padding: 2px 8px;
            border-radius: 8px;
            border: 1px solid var(--vscode-input-border);
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .info {
            margin-top: 12px;
            padding: 8px;
            background-color: var(--vscode-input-background);
            border-radius: 4px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    ${this.getControlPathHtml(control)}
    <div class="current-value" id="valueDisplay">${displayValue}</div>
    
    <div class="slider-container">
        <div class="custom-slider" id="customSlider">
            <div class="slider-track">
                <div class="slider-fill" id="sliderFill"></div>
            </div>
            <div class="slider-overlay" id="sliderOverlay"></div>
            <div class="slider-value-overlay" id="sliderValueOverlay">${displayValue}</div>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        const sliderOverlay = document.getElementById('sliderOverlay');
        const sliderFill = document.getElementById('sliderFill');
        const valueDisplay = document.getElementById('valueDisplay');
        const sliderValueOverlay = document.getElementById('sliderValueOverlay');
        
        let currentNormalized = ${normalizedValue};
        let currentDisplay = "${displayValue}";
        
        // Update visual slider fill
        function updateSliderFill(normalized) {
            const percentage = Math.max(0, Math.min(100, normalized * 100));
            sliderFill.style.width = percentage + '%';
        }
        
        // Initialize slider fill
        updateSliderFill(currentNormalized);
        
        function updateDisplay(newDisplay) {
            valueDisplay.textContent = newDisplay;
            sliderValueOverlay.textContent = newDisplay;
            currentDisplay = newDisplay;
        }
        
        function sendNormalizedValue(normalized) {
            vscode.postMessage({
                command: 'valueChanged',
                value: normalized
            });
        }
        
        // Custom slider drag handling - click anywhere and drag relative to that point
        let isSliderDragging = false;
        let sliderDragStartNormalized = 0;
        let sliderDragStartX = 0;
        
        sliderOverlay.addEventListener('mousedown', (e) => {
            isSliderDragging = true;
            
            // Store the current value and mouse position for relative dragging
            sliderDragStartNormalized = currentNormalized;
            sliderDragStartX = e.clientX;
            
            // NO immediate jump - only relative movement from this point
            
            e.preventDefault();
            document.body.style.cursor = 'ew-resize';
        });
        
        function handleSliderMouseMove(e) {
            if (!isSliderDragging) return;
            
            // Calculate movement from drag start
            const rect = sliderOverlay.getBoundingClientRect();
            const deltaX = e.clientX - sliderDragStartX;
            const deltaNormalized = deltaX / rect.width;
            
            // Apply delta to the original click position
            const newNormalized = Math.max(0, Math.min(1, sliderDragStartNormalized + deltaNormalized));
            currentNormalized = newNormalized;
            
            updateSliderFill(currentNormalized);
            sendNormalizedValue(currentNormalized);
        }
        
        function handleSliderMouseUp() {
            if (isSliderDragging) {
                isSliderDragging = false;
                document.body.style.cursor = 'default';
                sendNormalizedValue(currentNormalized);
            }
        }
        
        document.addEventListener('mousemove', handleSliderMouseMove);
        document.addEventListener('mouseup', handleSliderMouseUp);
        
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
            
            // Update custom slider fill immediately
            updateSliderFill(newNormalized);
            
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
                
        // Scroll wheel support for slider (horizontal scroll if available)
        sliderOverlay.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            // Try horizontal scroll first (deltaX), fallback to vertical (deltaY)
            const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? -e.deltaX : -e.deltaY;
            
            // Sensitivity: smaller than mouse drag
            const sensitivity = e.shiftKey ? 0.0002 : 0.001; // More precise with Shift
            const normalizedDelta = delta * sensitivity;
            
            // Apply delta to current normalized value
            const newNormalized = Math.max(0, Math.min(1, currentNormalized + normalizedDelta));
            currentNormalized = newNormalized;
            
            // Update custom slider fill immediately
            updateSliderFill(newNormalized);
            
            // Send update
            sendNormalizedValue(newNormalized);
        });
        
        // Listen for updates from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateValue') {
                // Only update values if not dragging (either value drag or slider drag)
                if (!isDragging && !isSliderDragging) {
                    if (message.normalizedValue !== undefined) {
                        currentNormalized = message.normalizedValue;
                        updateSliderFill(currentNormalized);
                    }
                }
                
                // Always update display value
                if (message.displayValue !== undefined) {
                    updateDisplay(message.displayValue);
                }
            } else if (message.command === 'updateDisplayOnly') {
                // During drag: only update display value, don't change slider/normalized
                if (message.displayValue !== undefined) {
                    updateDisplay(message.displayValue);
                }
            }
        });
    </script>
</body>
</html>`;
  }

  private getControlPathHtml(control: Control): string {
    const pathSegments = control.path.slice(); // Copy the path
    const name = pathSegments.pop(); // Remove and get the last segment (the name)

    let pathHtml = '<div class="control-path">';

    // Add parent segments
    if (pathSegments.length > 0) {
      pathHtml += pathSegments.map(segment => `<span class="path-segment">${segment}</span>`).join('<span class="path-separator">/</span>');
      pathHtml += '<span class="path-separator">/</span>';
    }

    // Add the name (bold and blue)
    pathHtml += `<span class="path-name">${control.spec.displayName || name}</span>`;
    pathHtml += '</div>';

    return pathHtml;
  }

  private getMultipleControlsHtml(controls: Array<{ control: Control, path: string[] }>): string {
    let html = `<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            padding: 15px;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            max-height: 100vh;
            overflow-x: visible;
            overflow-y: auto;
            column-count: 1;
            column-gap: 20px;
        }
        @media (min-width: 600px) {
            body { column-count: 2; }
        }
        @media (min-width: 1000px) {
            body { column-count: 3; }
        }
        .multi-selection-header {
            font-size: 16px;
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
            margin-bottom: 15px;
            border-bottom: 1px solid var(--vscode-input-border);
            padding-bottom: 8px;
        }
        .control-item {
            margin-bottom: 4px;
            padding: 4px;
            background-color: var(--vscode-input-background);
            border-radius: 4px;
            border-left: 3px solid var(--vscode-button-background);
            break-inside: avoid;
        }
        .control-path {
            margin-bottom: 2px;
            padding-bottom: 2px;
            border-bottom: 1px solid var(--vscode-input-border);
            font-size: 12px;
            line-height: 1.2;
            font-variant: small-caps;
        }
        .path-segment {
            color: var(--vscode-foreground);
        }
        .path-separator {
            color: var(--vscode-descriptionForeground);
            margin: 0 4px;
        }
        .path-name {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        
        /* Numeric control styles */
        .numeric-control {
            position: relative;
        }
        .slider-container {
            position: relative;
            height: 100%;
            margin: 2px 0;
        }
        .slider-track {
            width: 100%;
            height: 100%;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            position: absolute;
            top: 0;
            left: 0;
        }
        .slider-fill {
            height: 100%;
            background: var(--vscode-button-background);
            border-radius: 2px;
        }
        .slider-overlay {
            position: absolute;
            width: 100%;
            height: 100%;
            top: 0;
            left: 0;
            cursor: ew-resize;
            z-index: 2;
        }
        .slider-value-overlay {
            position: absolute;
            top: 50%;
            transform: translate(0%, -50%);
            font-weight: bold;
            font-size: 14px;
            color: var(--vscode-button-foreground);
            pointer-events: none;
            z-index: 3;
            padding: 2px 8px;
            border-radius: 8px;
        }
        
        /* String control styles */
        .string-control .control-value {
            padding: 8px;
            background-color: var(--vscode-editor-background);
            border-radius: 3px;
            font-family: var(--vscode-font-family);
            line-height: 1.4;
        }
        .string-control .control-value code {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 2px 4px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
        }
        .string-control .control-value a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }
        .string-control .control-value a:hover {
            text-decoration: underline;
        }
        .string-control .control-value p {
            margin: 8px 0;
        }
        .string-control .control-value p:first-child {
            margin-top: 0;
        }
        .string-control .control-value p:last-child {
            margin-bottom: 0;
        }
        
        /* Action control styles */
        .action-control .action-button {
            width: 100%; height: 100%;
            border: none;
            border-radius: 4px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        /* Toggleable buttons - ON state */
        .action-button.toggleable.toggle-on {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        /* Toggleable buttons - OFF state */
        .action-button.toggleable.toggle-off {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        /* Non-toggleable buttons - always lit */
        .action-button.non-toggleable.always-on {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .action-button.clicked {
            background-color: var(--vscode-button-hoverBackground);
            transition: background-color 0.1s ease;
        }
        .action-button:hover {
            opacity: 0.9;
        }
        
        /* Popup control styles */
        .popup-control {
            position: relative;
            width: 100%; height: 100%;
        }
        .popup-dropdown {
            position: relative;
            width: 100%; height: 100%;
            cursor: pointer;
        }
        .popup-current {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-left: 8px;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-weight: 500;
            height: 100%;
            user-select: none;
        }
        .popup-arrow {
            margin-left: 8px;
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            transition: transform 0.2s ease;
        }
        .popup-dropdown.open .popup-arrow {
            transform: rotate(180deg);
        }
        .popup-list {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background-color: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            border-top: none;
            border-radius: 0 0 4px 4px;
            max-height: 200px;
            overflow-y: auto;
            z-index: 1000;
            display: none;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        }
        .popup-list.flip-up {
            top: auto;
            bottom: 100%;
            border-top: 1px solid var(--vscode-dropdown-border);
            border-bottom: none;
            border-radius: 4px 4px 0 0;
            box-shadow: 0 -4px 8px rgba(0, 0, 0, 0.2);
        }
        .popup-dropdown.open .popup-list {
            display: block;
        }
        .popup-item {
            padding: 8px 12px;
            cursor: pointer;
            transition: background-color 0.1s ease;
        }
        .popup-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .popup-item:active {
            background-color: var(--vscode-list-activeSelectionBackground);
        }

        .numeric-control { height: 24px; }
        .action-control { height: 24px; }
        .popup-control { height: 24px; }

        @media (max-height: 300px) {
            body { padding: 6px; font-size: 13px; }
            .control-item { padding: 4px; margin-bottom: 4px; }
            .numeric-control { height: 20px; }
            .action-control { height: 20px; }
            .popup-control { height: 20px; }
            .slider-value-overlay { font-size: 12px; }
            .control-path { font-size: 10px; margin-bottom: 2px; padding-bottom: 2px; }
            .action-control .action-button { font-size: 12px; }
            .popup-current { font-size: 12px; }
        }
        
        @media (max-height: 160px) {
            body { padding: 2px; font-size: 10px; }
            .control-item { padding: 2px; margin-bottom: 2px; }
            .numeric-control { height: 16px; }
            .action-control { height: 16px; }
            .popup-control { height: 16px; }
            .slider-value-overlay { font-size: 10px; }
            .control-path { font-size: 8px; margin-bottom: 1px; padding-bottom: 1px; }
            .action-control action-button { font-size: 10px; }
            .popup-current { font-size: 10px; }
        }
    </style>
</head>
<body>
    `;

    // Show all controls in order
    for (const { control, path } of controls) {
      // Format the path nicely
      const pathSegments = path.slice(); // Copy the path
      const name = pathSegments.pop(); // Remove and get the last segment (the name)

      let pathHtml = '<div class="control-path">';

      // Add parent segments
      if (pathSegments.length > 0) {
        pathHtml += pathSegments.map(segment => `<span class="path-segment">${segment}</span>`).join('<span class="path-separator">/</span>');
        pathHtml += '<span class="path-separator">/</span>';
      }

      // Add the name (bold and blue)
      pathHtml += `<span class="path-name">${control.spec.displayName || name}</span>`;
      pathHtml += '</div>';

      html += `<div class="control-item">
        ${pathHtml}`;

      if (control.spec.type === 'numeric') {
        const displayValue = control.displayValue || String(control.value);
        const normalizedValue = control.normalizedValue || 0;
        const fillPercentage = Math.max(0, Math.min(100, normalizedValue * 100));
        const pathStr = path.join('/');

        html += `<div class="numeric-control">
          <div class="slider-container">
            <div class="slider-track">
              <div class="slider-fill" id="slider-fill-${pathStr.replace(/[^a-zA-Z0-9]/g, '_')}" style="width: ${fillPercentage}%"></div>
            </div>
            <div class="slider-overlay" data-path="${pathStr}" data-current="${normalizedValue}"></div>
            <div class="slider-value-overlay" id="value-${pathStr.replace(/[^a-zA-Z0-9]/g, '_')}">${displayValue}</div>
          </div>
        </div>`;

      } else if (control.spec.type === 'string') {
        const value = String(control.value);
        // Convert markdown to HTML using marked library
        let finalHtml: string;
        try {
          finalHtml = marked.parse(value) as string;
        } catch (error) {
          console.warn('Failed to render markdown, falling back to plain text:', error);
          // Fallback to basic HTML escaping if markdown rendering fails
          finalHtml = value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
        }

        html += `<div class="string-control">
          <div class="control-value">${finalHtml}</div>
        </div>`;

      } else if (control.spec.type === 'action') {
        const spec = control.spec as ActionSpec;
        const isOn = control.value === true || control.normalizedValue === 1;
        const buttonText = control.displayValue;
        // For toggleable buttons, show different styling based on state
        // For non-toggleable buttons, always show as lit (primary styling)
        const toggleClass = spec.toggleable ? 'toggleable' : 'non-toggleable';
        const stateClass = spec.toggleable ? (isOn ? 'toggle-on' : 'toggle-off') : 'always-on';
        const pathStr = path.join('/');

        html += `<div class="action-control">
          <button class="action-button ${toggleClass} ${stateClass}" data-path="${pathStr}">${buttonText}</button>
        </div>`;

      } else if (control.spec.type === 'popup') {
        const spec = control.spec as PopupSpec;
        const currentValue = control.value || spec.items?.[0] || '';
        const pathStr = path.join('/');
        const cleanId = pathStr.replace(/[^a-zA-Z0-9]/g, '_');

        html += `<div class="popup-control" id="popup-container-${cleanId}">
          <div class="popup-dropdown" data-path="${pathStr}">
            <div class="popup-current" id="popup-current-${cleanId}">
              <span class="popup-text">${currentValue}</span>
              <span class="popup-arrow">▼</span>
            </div>
            <div class="popup-list" id="popup-list-${cleanId}">
              ${spec.items.map(item => `<div class="popup-item" data-value="${item}">${item}</div>`).join('')}
            </div>
          </div>
        </div>`;
      }

      html += `</div>`;
    }

    html += `
    <script>
        const vscode = acquireVsCodeApi();
        
        // Single drag state
        let isDragging = false;
        let dragStartNormalized = 0;
        let dragStartX = 0;
        let dragPath = null;
        
        function sendNormalizedValue(path, normalized) {
            console.log('Sending value to server:', path, normalized);
            vscode.postMessage({
                command: 'valueChanged',
                path: path.split('/'),
                value: normalized
            });
        }
        
        // Single mouse move handler
        function handleMouseMove(e) {
            if (!isDragging || !dragPath) {
                console.log('Mouse move but not dragging:', isDragging, dragPath);
                return;
            }
            
            console.log('Mouse move during drag, deltaX:', e.clientX - dragStartX);
            
            const overlay = document.querySelector(\`[data-path="\${dragPath}"]\`);
            if (!overlay) {
                console.log('No overlay found for path:', dragPath);
                return;
            }
            
            // Calculate movement from drag start
            const deltaX = e.clientX - dragStartX;
            const rect = overlay.getBoundingClientRect();
            const deltaNormalized = deltaX / rect.width;
            
            // Apply delta to the original start value
            const newNormalized = Math.max(0, Math.min(1, dragStartNormalized + deltaNormalized));
            
            console.log('Sending normalized value:', newNormalized);
            
            // Send to server - let server update the display
            sendNormalizedValue(dragPath, newNormalized);
        }
        
        // Single mouse up handler
        function handleMouseUp() {
            if (isDragging) {
                console.log('Mouse up, ending drag for:', dragPath);
                isDragging = false;
                document.body.style.cursor = 'default';
                document.body.style.userSelect = '';
                dragPath = null;
            }
        }
        
        // Attach event listeners to all slider overlays
        document.querySelectorAll('.slider-overlay').forEach(overlay => {
            const path = overlay.getAttribute('data-path');
            
            overlay.addEventListener('mousedown', (e) => {
                console.log('Mouse down on slider:', path);
                
                // Stop any existing drag first
                if (isDragging) {
                    console.log('Stopping existing drag');
                    handleMouseUp();
                }
                
                isDragging = true;
                dragPath = path;
                
                // Get current normalized value from server data
                dragStartNormalized = parseFloat(overlay.getAttribute('data-current')) || 0;
                dragStartX = e.clientX;
                
                console.log('Starting drag:', path, 'startValue:', dragStartNormalized);
                
                e.preventDefault();
                e.stopPropagation();
                document.body.style.cursor = 'ew-resize';
                
                // Ensure we capture mouse events
                document.body.style.userSelect = 'none';
            });
            
            // Handle scroll wheel
            overlay.addEventListener('wheel', (e) => {
                e.preventDefault();
                
                const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? -e.deltaX : -e.deltaY;
                const sensitivity = e.shiftKey ? 0.0002 : 0.001;
                const normalizedDelta = delta * sensitivity;
                
                // Get current value and apply delta
                const currentNormalized = parseFloat(overlay.getAttribute('data-current')) || 0;
                const newNormalized = Math.max(0, Math.min(1, currentNormalized + normalizedDelta));
                
                // Send to server
                sendNormalizedValue(path, newNormalized);
            });
        });
        
        // Single set of document event listeners
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isDragging) {
                handleMouseUp();
            }
        });
        
        // Action button handlers
        document.querySelectorAll('.action-button').forEach(button => {
            const path = button.getAttribute('data-path');
            
            button.addEventListener('click', (e) => {
                // Prevent double clicks
                e.preventDefault();
                
                // Add visual click feedback
                button.classList.add('clicked');
                setTimeout(() => button.classList.remove('clicked'), 150);
                
                vscode.postMessage({
                    command: 'actionTriggered',
                    path: path.split('/')
                });
            });
        });
        
        // Popup dropdown handlers
        document.querySelectorAll('.popup-dropdown').forEach(dropdown => {
            const path = dropdown.getAttribute('data-path');
            const pathClean = path.replace(/[^a-zA-Z0-9]/g, '_');
            const currentDiv = document.getElementById('popup-current-' + pathClean);
            const listDiv = document.getElementById('popup-list-' + pathClean);
            
            // Toggle dropdown on click
            currentDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.classList.toggle('open');
                
                // Check if dropdown should flip up to stay in viewport
                if (dropdown.classList.contains('open')) {
                    const rect = dropdown.getBoundingClientRect();
                    const listHeight = 200; // max-height of popup-list
                    const spaceBelow = window.innerHeight - rect.bottom;
                    const spaceAbove = rect.top;
                    
                    // If not enough space below but enough space above, flip up
                    if (spaceBelow < listHeight && spaceAbove > listHeight) {
                        listDiv.classList.add('flip-up');
                    } else {
                        listDiv.classList.remove('flip-up');
                    }
                }
            });
            
            // Handle item selection
            listDiv.querySelectorAll('.popup-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const selectedValue = item.getAttribute('data-value');
                    
                    // Update display
                    currentDiv.querySelector('.popup-text').textContent = selectedValue;
                    dropdown.classList.remove('open');
                    
                    // Calculate normalized value and send to server
                    const allItems = Array.from(listDiv.querySelectorAll('.popup-item'));
                    const selectedIndex = allItems.indexOf(item);
                    const normalizedValue = allItems.length > 1 ? selectedIndex / (allItems.length - 1) : 0;
                    
                    console.log('Popup selection:', selectedValue, 'index:', selectedIndex, 'normalized:', normalizedValue);
                    
                    vscode.postMessage({
                        command: 'valueChanged',
                        path: path.split('/'),
                        value: normalizedValue
                    });
                });
            });
        });
        
        // Close dropdowns when clicking outside
        document.addEventListener('click', () => {
            document.querySelectorAll('.popup-dropdown.open').forEach(dropdown => {
                dropdown.classList.remove('open');
            });
        });
        
        // Debug logging
        console.log('Control setup complete. Found', document.querySelectorAll('.slider-overlay').length, 'sliders,', document.querySelectorAll('.action-button').length, 'action buttons,', document.querySelectorAll('.popup-dropdown').length, 'popup dropdowns');
        
        // Listen for updates from server
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateValue') {
                const pathStr = message.path.join('/');
                const sliderId = pathStr.replace(/[^a-zA-Z0-9]/g, '_');
                
                // Update slider fill
                if (message.normalizedValue !== undefined) {
                    const fillElement = document.getElementById('slider-fill-' + sliderId);
                    if (fillElement) {
                        const percentage = Math.max(0, Math.min(100, message.normalizedValue * 100));
                        fillElement.style.width = percentage + '%';
                    }
                    
                    // Update data attribute for next drag
                    const overlay = document.querySelector(\`[data-path="\${pathStr}"]\`);
                    if (overlay) {
                        overlay.setAttribute('data-current', message.normalizedValue);
                    }
                }
                
                // Update display value
                if (message.displayValue !== undefined) {
                    const valueElement = document.getElementById('value-' + sliderId);
                    if (valueElement) {
                        valueElement.textContent = message.displayValue;
                    }
                }
                
                // Update popup controls
                if (message.value !== undefined && typeof message.value === 'string') {
                    const popupTextElement = document.querySelector(\`#popup-current-\${sliderId} .popup-text\`);
                    if (popupTextElement) {
                        popupTextElement.textContent = message.value;
                    }
                }
                
                // Update action button states
                if (message.normalizedValue !== undefined) {
                    const button = document.querySelector(\`.action-button[data-path="\${pathStr}"]\`);
                    if (button) {
                        button.textContent = message.displayValue;
                        if (message.normalizedValue === 1) {
                            button.classList.add('toggle-on');
                            button.classList.remove('toggle-off');
                        } else {
                            button.classList.add('toggle-off');
                            button.classList.remove('toggle-on');
                        }
                    }
                }
            }
        });
    </script>
</body>
</html>`;

    return html;
  }

  private getActionControlHtml(control: Control): string {
    const spec = control.spec as ActionSpec;
    const isToggleable = spec.toggleable || false;
    const isOn = control.value === true;
    const isEnabled = spec.enabled !== false;

    let buttonText = control.spec.displayName || control.path[control.path.length - 1];
    let buttonClass = 'btn-primary';

    if (!isEnabled) {
      buttonText = `${buttonText} (Disabled)`;
      buttonClass = 'btn-disabled';
    } else if (isToggleable) {
      buttonText = `${buttonText}`;
      buttonClass = isOn ? 'btn-success' : 'btn-secondary';
    }

    return `<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            padding: 15px;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            overflow: overlay;
        }
        
        /* Scale down for smaller panels */
        @media (max-width: 400px) {
            body { padding: 10px; font-size: 13px; }
            .control-path { font-size: 12px; margin-bottom: 6px; padding-bottom: 4px; }
            .action-button { font-size: 14px; }
            .action-info { margin-top: 6px; padding: 6px; font-size: 11px; }
        }
        
        @media (max-width: 300px) {
            body { padding: 6px; font-size: 12px; }
            .control-path { font-size: 11px; margin-bottom: 4px; padding-bottom: 3px; }
            .action-button { font-size: 13px; }
            .action-info { margin-top: 4px; padding: 4px; font-size: 10px; }
        }
        .control-path {
            margin-bottom: 10px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-input-border);
            font-size: 14px;
            line-height: 1.2;
        }
        .path-segment {
            color: var(--vscode-foreground);
        }
        .path-separator {
            color: var(--vscode-descriptionForeground);
            margin: 0 6px;
        }
        .path-name {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        .action-button {
            width: 100%;
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
        .action-button.clicked {
            background-color: var(--vscode-button-hoverBackground);
            transition: background-color 0.1s ease;
        }
        .action-info {
            margin-top: 10px;
            padding: 8px;
            background-color: var(--vscode-input-background);
            border-radius: 4px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    ${this.getControlPathHtml(control)}
    
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
        const button = document.querySelector('.action-button');
        
        function triggerAction() {
            if (${isEnabled}) {
                // Add visual click feedback
                button.classList.add('clicked');
                setTimeout(() => button.classList.remove('clicked'), 150);
                
                vscode.postMessage({ command: "actionTriggered" });
            }
        }
    </script>
</body>
</html>`;
  }

  private getPopupControlHtml(control: Control): string {
    const spec = control.spec as PopupSpec;
    const items = spec.items || [];
    const currentValue = control.value as string || items[0] || '';

    return `<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            padding: 20px;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            overflow: hidden;
        }
        
        @media (max-width: 400px) {
            body { padding: 12px; font-size: 13px; }
            .control-path { font-size: 12px; margin-bottom: 6px; padding-bottom: 4px; }
            .popup-button { padding: 8px 12px; font-size: 14px; }
        }
        
        @media (max-width: 300px) {
            body { padding: 8px; font-size: 12px; }
            .control-path { font-size: 11px; margin-bottom: 4px; padding-bottom: 3px; }
            .popup-button { padding: 6px 10px; font-size: 13px; }
        }
        
        .control-path {
            margin-bottom: 10px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-input-border);
            font-size: 14px;
            line-height: 1.2;
            font-variant: small-caps;
        }
        .path-segment {
            color: var(--vscode-foreground);
        }
        .path-separator {
            color: var(--vscode-descriptionForeground);
            margin: 0 6px;
        }
        .path-name {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        
        .popup-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            margin-top: 20px;
        }
        
        .current-value {
            font-size: 18px;
            font-weight: bold;
            text-align: center;
            margin-bottom: 15px;
            padding: 10px 20px;
            background-color: var(--vscode-input-background);
            border-radius: 6px;
            min-width: 200px;
        }
        
        .popup-button {
            padding: 10px 20px;
            font-size: 14px;
            font-weight: 500;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .popup-button:hover {
            transform: translateY(-1px);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }
        
        .popup-button:active {
            transform: translateY(0);
            box-shadow: none;
        }
    </style>
</head>
<body>
    ${this.getControlPathHtml(control)}
    
    <div class="popup-container">
        <div class="current-value" id="currentValue">${currentValue}</div>
        <button id="selectButton" class="popup-button">Select Item</button>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        const button = document.getElementById('selectButton');
        const valueDisplay = document.getElementById('currentValue');
        
        let currentValue = "${currentValue}";
        const items = ${JSON.stringify(items)};
        
        button.addEventListener('click', () => {
            vscode.postMessage({
                command: 'showPopupList',
                items: items,
                current: currentValue
            });
        });
        
        // Listen for updates from server
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateValue') {
                if (message.value !== undefined) {
                    currentValue = message.value;
                    valueDisplay.textContent = currentValue;
                }
            }
        });
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

    // Register the tree view with multi-select enabled
    this.treeView = vscode.window.createTreeView('supercolliderControls', {
      treeDataProvider: this.provider,
      showCollapseAll: true,
      canSelectMany: true
    });

    // Register the webview provider
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(ControlDetailWebviewProvider.viewType, this.detailView)
    );

    // Set up value change handler
    this.detailView.setValueChangeHandler((path: string[], value: number | string | boolean) => {
      this.provider.handleValueChange(path, value, this.client);
    });

    // Set up action trigger handler
    this.detailView.setActionTriggerHandler((path: string[]) => {
      this.provider.handleActionTrigger(path, this.client);
    });

    // Handle tree selection changes (multi-select)
    this.treeView.onDidChangeSelection(e => {
      const selectedControls = e.selection
        .filter(item => item.itemType === 'control' && item.control && item.path)
        .map(item => ({ control: item.control!, path: item.path! }));

      if (selectedControls.length > 0) {
        // For single selection, track the path for updates
        if (selectedControls.length === 1) {
          this.currentSelectedPath = selectedControls[0].path;
        } else {
          this.currentSelectedPath = undefined; // No single path for multi-select
        }

        this.detailView.showControls(selectedControls);
      } else {
        this.currentSelectedPath = undefined;
        this.detailView.showControls([]);
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

    // Ensure cleanup on disposal
    context.subscriptions.push({
      dispose: () => {
        this.provider.dispose();
      }
    });
  }

  private async editControlValue(path: string[], control: Control) {
    const currentValue = this.provider.getValue(path) ?? control.value;

    if (control.spec.type === 'numeric') {
      // For numeric controls, show a simple input for the display value
      const displayValue = control.displayValue || String(control.value);
      const prompt = `${control.spec.displayName || control.path[control.path.length - 1]} (current: ${displayValue})`;

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
        `${control.spec.displayName || control.path[control.path.length - 1]}`,
        { modal: true, detail: currentValue as string }
      );
    } else if (control.spec.type === 'popup') {
      // For popup controls, show the dialog using the detail view
      const spec = control.spec as PopupSpec;
      await this.detailView.showPopupDialog(spec.items, currentValue as string, path);
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

    // Update the detail view for any selected controls
    this.detailView.updateControlValueByPath(path, displayValue, normalizedValue);

    // Keep legacy single-control update for backward compatibility
    if (this.currentSelectedPath && this.currentSelectedPath.join('/') === path.join('/')) {
      this.detailView.updateControlValue(displayValue, normalizedValue);
    }
  }

  selectControl(path: string[]) {
    // Find the control in our data
    const control = this.provider.getControl(path);
    if (!control) {
      console.log(`Control not found for path: ${path.join('/')}`);
      return;
    }

    // Expand the tree to reveal the control (if needed)
    this.expandPathToControl(path);

    // Set the current selected path and update the detail view
    this.currentSelectedPath = path;
    this.detailView.showControl(control, path);

    console.log(`Selected control: ${path.join('/')}`);
  }

  private expandPathToControl(path: string[]) {
    // For now, we'll just expand all parent categories
    // In a future enhancement, we could use the tree view API to expand specific nodes
    // but this requires more complex tree node tracking
    console.log(`Expanding path to reveal control: ${path.join('/')}`);
  }

  setClient(client: any) {
    this.client = client;
  }
}