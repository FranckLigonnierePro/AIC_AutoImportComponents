import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

class ComponentProvider implements vscode.TreeDataProvider<Component> {
  private _onDidChangeTreeData: vscode.EventEmitter<Component | undefined> = new vscode.EventEmitter<Component | undefined>();
  readonly onDidChangeTreeData: vscode.Event<Component | undefined> = this._onDidChangeTreeData.event;

  private components: Component[] = [];
  private filteredComponents: Component[] = [];
  private searchQuery: string = '';

  constructor(private workspaceRoot: string) {
    this.refresh();
  }

  refresh() {
    if (this.workspaceRoot) {
      const componentsPath = path.join(this.workspaceRoot, 'src', 'components', 'ui');
      if (fs.existsSync(componentsPath)) {
        this.components = this.getVueFilesHierarchy(componentsPath);
        this.applyFilter();
        this._onDidChangeTreeData.fire(undefined);
      } else {
        console.log("Le chemin src/components/ui n'existe pas.");
      }
    }
  }

  getVueFilesHierarchy(dir: string, basePath: string = dir): Component[] {
    const files = fs.readdirSync(dir);
    let vueComponents: Component[] = [];

    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        const folderComponent = new Component(file, fullPath, vscode.TreeItemCollapsibleState.Collapsed);
        folderComponent.children = this.getVueFilesHierarchy(fullPath, basePath);
        vueComponents.push(folderComponent);
      } else if (file.endsWith('.vue')) {
        const componentNameWithoutExtension = path.basename(file, '.vue');
        const relativePath = fullPath.replace(basePath, '');
        vueComponents.push(new Component(componentNameWithoutExtension, fullPath, vscode.TreeItemCollapsibleState.None, relativePath));
      }
    }

    vueComponents.sort((a, b) => {
      if (a.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed && b.collapsibleState === vscode.TreeItemCollapsibleState.None) {
        return -1;
      } else if (a.collapsibleState === vscode.TreeItemCollapsibleState.None && b.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed) {
        return 1;
      } else {
        return a.label.localeCompare(b.label);
      }
    });

    return vueComponents;
  }

  setSearchQuery(query: string) {
    this.searchQuery = query;
    this.applyFilter();
    this._onDidChangeTreeData.fire(undefined);
  }

  applyFilter() {
    if (!this.searchQuery) {
      this.filteredComponents = this.components;
    } else {
      this.filteredComponents = this.filterComponents(this.components, this.searchQuery.toLowerCase());
    }
  }

  filterComponents(components: Component[], query: string): Component[] {
    return components
      .filter(component => component.label.toLowerCase().includes(query) || 
                           (component.children && component.children.length > 0))
      .map(component => {
        if (component.children) {
          const filteredChildren = this.filterComponents(component.children, query);
          return new Component(component.label, component.fullPath, vscode.TreeItemCollapsibleState.Collapsed, component.relativePath, filteredChildren);
        }
        return component;
      });
  }

  getChildren(element?: Component): Component[] {
    return element ? (element.children || []) : this.filteredComponents;
  }

  getTreeItem(element: Component): vscode.TreeItem {
    return element;
  }
}

class Component extends vscode.TreeItem {
  public children: Component[] | undefined;
  
  constructor(
    public readonly label: string,
    public readonly fullPath: string,
    public collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly relativePath?: string,
    children?: Component[]
  ) {
    super(label, collapsibleState);
    this.children = children;
    if (collapsibleState === vscode.TreeItemCollapsibleState.None) {
      this.command = {
        command: 'extension.importComponent',
        title: 'Import Component',
        arguments: [this.fullPath]
      };
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  const workspaceRoot = vscode.workspace.rootPath || '';
  const componentProvider = new ComponentProvider(workspaceRoot);

  const view = vscode.window.createTreeView('componentList', {
    treeDataProvider: componentProvider,
    showCollapseAll: true
  });

  context.subscriptions.push(view);

  const searchBox = vscode.window.createInputBox();
  searchBox.prompt = 'Rechercher un composant';
  searchBox.onDidChangeValue(value => {
    componentProvider.setSearchQuery(value);
  });

  // Afficher le champ de recherche lorsque l'onglet de l'extension est sélectionné
  view.onDidChangeVisibility(e => {
    if (e.visible) {
      searchBox.show();
    } else {
      searchBox.hide();
    }
  });

  // Ajouter un raccourci clavier pour afficher la boîte de recherche en dehors de l'onglet
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.showSearchBox', () => {
      searchBox.show();
    })
  );

  // Ajoutez le raccourci dans `package.json` pour `extension.showSearchBox`
  //   "contributes": {
  //     "commands": [
  //       {
  //         "command": "extension.showSearchBox",
  //         "title": "Afficher le champ de recherche de composants"
  //       }
  //     ],
  //     "keybindings": [
  //       {
  //         "command": "extension.showSearchBox",
  //         "key": "ctrl+shift+f", // Définissez la combinaison de touches souhaitée
  //         "when": "editorTextFocus"
  //       }
  //     ]
  //   }

  context.subscriptions.push(
    vscode.commands.registerCommand('extension.importComponent', async (componentFullPath: string) => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const document = editor.document;
        const editBuilder = new vscode.WorkspaceEdit();

        const componentNameWithoutExtension = path.basename(componentFullPath, '.vue');
        const newPath = componentFullPath.replace(/.*\/components/, '@/components');
        const documentText = document.getText();

        const importExists = documentText.includes(`import ${componentNameWithoutExtension} from '${newPath}'`);
        
        if (!importExists) {
          const importPos = documentText.indexOf('<script lang="ts">');
          if (importPos !== -1) {
            const insertPos = document.positionAt(importPos + '<script lang="ts">'.length);
            const importStatement = `\nimport ${componentNameWithoutExtension} from '${newPath}';\n`;
            editBuilder.insert(document.uri, insertPos, importStatement);
          }
        }
        
        const componentsMatch = documentText.match(/components\s*:\s*\{([\s\S]*?)\}/);
        if (componentsMatch) {
          const componentsSection = componentsMatch[1];
          if (!componentsSection.includes(componentNameWithoutExtension)) {
            const insertPos = document.positionAt(componentsMatch.index! + componentsMatch[0].length - 1);
            editBuilder.insert(document.uri, insertPos, `\n\t${componentNameWithoutExtension},`);
          }
        }

        const position = editor.selection.active;
        editBuilder.insert(document.uri, position, `<${componentNameWithoutExtension} />`);
        
        await vscode.workspace.applyEdit(editBuilder);
        await document.save();
        await vscode.window.showInformationMessage(`${componentNameWithoutExtension} imported successfully!`);
      }
    })
  );
}

export function deactivate() {}
