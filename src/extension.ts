import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

class ComponentProvider implements vscode.TreeDataProvider<Component> {
  private _onDidChangeTreeData: vscode.EventEmitter<Component | undefined> = new vscode.EventEmitter<Component | undefined>();
  readonly onDidChangeTreeData: vscode.Event<Component | undefined> = this._onDidChangeTreeData.event;

  private components: string[] = [];
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.refresh();
  }

  refresh() {
    if (this.workspaceRoot) {
      const componentsPath = path.join(this.workspaceRoot, 'src', 'components', 'ui');
      if (fs.existsSync(componentsPath)) {
        this.components = this.getVueFilesRecursively(componentsPath); // Gardez le chemin complet
        console.log("Composants trouvés : ", this.components);
        this._onDidChangeTreeData.fire(undefined);
      } else {
        console.log("Le chemin src/components n'existe pas.");
      }
    }
  }

  getVueFilesRecursively(dir: string): string[] {
    const files = fs.readdirSync(dir);
    let vueFiles: string[] = [];

    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // Récursivement parcourir les sous-dossiers
        vueFiles = vueFiles.concat(this.getVueFilesRecursively(fullPath));
      } else if (file.endsWith('.vue')) {
        // Ajouter les fichiers .vue trouvés
        vueFiles.push(fullPath); // Garder le chemin complet
      }
    }

    return vueFiles;
  }

  getChildren(): Component[] {
    return this.components.map(component => {
      const componentName = path.basename(component); // Garder le nom complet avec l'extension
      const componentNameWithoutExtension = path.basename(component, '.vue'); // Retirer l'extension .vue
      return new Component(componentNameWithoutExtension, component); // Passer le chemin complet
    });
  }

  getTreeItem(element: Component): vscode.TreeItem {
    return element;
  }
}

class Component extends vscode.TreeItem {
  constructor(public readonly label: string, public readonly fullPath: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.command = {
      command: 'extension.importComponent',
      title: 'Import Component',
      arguments: [this.fullPath] // Passer le chemin complet
    };
  }
}

export function activate(context: vscode.ExtensionContext) {
  const workspaceRoot = vscode.workspace.rootPath || '';
  const componentProvider = new ComponentProvider(workspaceRoot);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('componentList', componentProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('extension.importComponent', async (componentFullPath: string) => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const document = editor.document;
        const editBuilder = new vscode.WorkspaceEdit();

        // Utilisation du chemin complet pour l'importation
        const componentNameWithoutExtension = path.basename(componentFullPath, '.vue');
        const newPath = componentFullPath.replace(/.*\/components/, '@/components');
        // Récupérer le texte actuel du document
        const documentText = document.getText();
        
        // Vérification si l'import existe déjà
        const importExists = documentText.includes(`import ${componentNameWithoutExtension} from '${newPath}'`);
        
        if (!importExists) {
          // Ajouter la ligne d'importation si elle n'existe pas déjà
          const importPos = document.positionAt(documentText.indexOf('<script lang="ts">') + '<script lang="ts">'.length);
          const importStatement = `\nimport ${componentNameWithoutExtension} from '${newPath}';\n`;
          editBuilder.insert(document.uri, importPos, importStatement);
        }
        
        // Vérifier si le composant est déjà dans l'objet components
        const componentsIndex = documentText.indexOf('components: {');
        if (componentsIndex !== -1) {
          const componentsSectionText = documentText.substring(componentsIndex, documentText.indexOf('}', componentsIndex));
        
          if (!componentsSectionText.includes(`${componentNameWithoutExtension}`)) {
            // Ajouter le composant dans l'objet components s'il n'y est pas déjà
            const componentsPos = document.positionAt(componentsIndex + 14); // 14 pour sauter "components: {"
            editBuilder.insert(document.uri, componentsPos, `\n\t${componentNameWithoutExtension},`);
          }
        }
        
        // Récupérer la position du curseur pour insérer le composant dans le template
        const position = editor.selection.active;
        editBuilder.insert(document.uri, position, `<${componentNameWithoutExtension} />`);
        
        // Appliquer les modifications
        await vscode.workspace.applyEdit(editBuilder);
        await document.save();
      }
    })
  );
}

export function deactivate() {}

