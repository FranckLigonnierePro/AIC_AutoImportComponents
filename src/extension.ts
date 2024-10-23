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
      const componentsPath = path.join(this.workspaceRoot, 'src', 'components');
      if (fs.existsSync(componentsPath)) {
        this.components = this.getVueFilesRecursively(componentsPath).map(file => {
          return path.relative(componentsPath, file); // Utiliser le chemin relatif à 'components'
        });
        console.log("Composants trouvés : ", this.components); // Ajout d'un log pour vérifier les composants
        this._onDidChangeTreeData.fire(undefined); // Passer undefined pour indiquer un changement
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
    // Afficher uniquement les noms de composants sans l'extension .vue
    return this.components.map(component => {
      const componentName = path.basename(component); // Garder le nom complet avec l'extension
      const componentNameWithoutExtension = path.basename(component, '.vue'); // Retirer l'extension .vue
      return new Component(componentNameWithoutExtension, componentName); // Passer le nom sans extension
    });
  }

  getTreeItem(element: Component): vscode.TreeItem {
    return element;
  }
}

class Component extends vscode.TreeItem {
  constructor(public readonly label: string, public readonly fullName: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.command = {
      command: 'extension.importComponent',
      title: 'Import Component',
      arguments: [this.fullName] // Passer le nom complet avec l'extension
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
    vscode.commands.registerCommand('extension.importComponent', async (componentName: string) => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const document = editor.document;
        const editBuilder = new vscode.WorkspaceEdit();

        // Trouver le chemin complet du fichier à partir du nom
        const fullPath = path.join(workspaceRoot, 'src', 'components', componentName);

        // Utiliser le chemin de base pour l'importation
        const importPos = document.positionAt(document.getText().indexOf('<script lang="ts">') + '<script lang="ts">'.length);

        // Récupérer le nom sans l'extension pour l'importation
        const componentNameWithoutExtension = path.basename(componentName, '.vue');
        const importStatement = `\nimport ${componentNameWithoutExtension} from '@/components/${componentName}';\n`; // Pas besoin de '.vue' ici
        editBuilder.insert(document.uri, importPos, importStatement); // Ajouter l'URI du document ici

        const componentsIndex = document.getText().indexOf('components: {');
        if (componentsIndex !== -1) {
          const componentsPos = document.positionAt(componentsIndex + 12); // 12 pour sauter "components: {"
          editBuilder.insert(document.uri, componentsPos, `\n\t${componentNameWithoutExtension},`); // Ajouter une tabulation avant le nom du composant
        }

        await vscode.workspace.applyEdit(editBuilder);
        await document.save();
      }
    })
  );
}

export function deactivate() {}
