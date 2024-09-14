import { App, SuggestModal, Notice, Platform, TFile } from 'obsidian';
import { spawn } from 'child_process';
import RecollSearch from 'main';
import { formatUnixTime } from 'utils';
import { FilterType } from 'types';

// Interface for Recoll result
interface RecollResult {
    fileName: string;
    filePath: string;
    fileType: string;
    createdDate: string;
    modifiedDate: string;
    tags: string[];
    relevance: string;
}

const filter_msg = {
    0 : 'only md files',  // MARKDOWN = 0
    1 : 'all files excluding dirs', // ANY_FILE = 1
    2 : 'all files and dirs' // ANY = 2
};

enum MetaKeyBehavior {
    WINDOW = 'window',
    SPLIT = 'split',
    TAB = 'tab',
}

export class RecollqSearchModal extends SuggestModal<RecollResult> {
    private recollindex_cmd: string;
    private vaultPath: string;
    private labelsEl: HTMLElement | null = null;
    private filterEl: HTMLElement | null = null;

    constructor(app: App, private plugin: RecollSearch) {
        super(app);
        this.setPlaceholder(`Search for files ...`);
        this.setInstructions(this.getInstructionsBasedOnOS());

        // Store the address to recollq cmd
        this.recollindex_cmd = this.plugin.localSettings.recollqCmd;
        this.vaultPath = this.plugin.getVaultPath();
    }

    getInstructionsBasedOnOS(): { command: string, purpose: string } [] {
        let altSymbol;
        if (Platform.isMacOS) {
            altSymbol = '⌥';
        } else { // Default to Windows/Linux bindings
            altSymbol = 'Alt';
        }
        return [
            { command: 'Search:', purpose: filter_msg[this.plugin.settings.filterType] },
            { command: 'TAB', purpose: 'switch filter' },
            { command: '↑↓', purpose: 'navigate' },
            { command: "↵", purpose: "open the selected paper" },
            { command: altSymbol, purpose: 'open it in a new tab' },
            { command: 'esc', purpose: 'to dismiss' },
        ];
    }

    // Helper function to call recollq using spawn and return real search results
    private executeRecollq(query: string): Promise<RecollResult[]> {
        return new Promise((resolve, reject) => {
            // Use spawn to execute the recollq command

            // -F <field name list> : output exactly these fields for each result.
            // The field values are encoded in base64, output in one line and
            // separated by one space character. This is the recommended format
            // for use by other programs. Use a normal query with option -m to
            // see the field names. Use -F '' to output all fields, but you probably
            // also want option -N in this case.
            // -S fld : sort by field <fld>
            const recollq = spawn(this.recollindex_cmd, ['-F', 'url mtype created modified tags relevancyrating', '-S', 'relevancyrating', query]);

            let stdout = '';
            let stderr = '';

            // Capture standard output
            recollq.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            // Capture standard error
            recollq.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            // Handle process completion
            recollq.on('close', (code) => {
                if (code !== 0) {
                    console.error(`recollq process exited with code ${code}`);
                    console.error(stderr);
                    return reject(stderr);
                }

                const results: RecollResult[] = [];

                // Process the output from recollq
                const lines = stdout.trim().split('\n');
                for (const line of lines.slice(2)) {
                    const decodedFields = line.split(' ').map((field:string) => Buffer.from(field, 'base64').toString('utf-8'));
                    // Destructure the decoded fields into individual variables
                    const [url, mtype, created, modified, tags, relevance] = decodedFields;
                    results.push({
                        fileName: url.split('/').pop() || '',
                        filePath: url,
                        fileType: mtype,
                        createdDate:  created === "" ? "" : formatUnixTime(parseInt(created,10),this.plugin.settings.dateFormat),
                        modifiedDate: modified === "" ? "" : formatUnixTime(parseInt(modified,10),this.plugin.settings.dateFormat),
                        tags: tags==='' ? [] : tags.split(','),
                        relevance: relevance
                    });
                }
                resolve(results);
            });

            // Handle errors in spawning the process
            recollq.on('error', (error) => {
                console.error(`Failed to start recollq: ${error.message}`);
                reject(error.message);
            });
        });
    }

    // Fetch real suggestions using recollq
    async getSuggestions(input_query: string): Promise<RecollResult[]> {
        if(input_query.trim()==='') {
            if(this.labelsEl) this.labelsEl.style.display = 'none';
            return [] as RecollResult[];
        }

        let query:string[] = [input_query];

        switch(this.plugin.settings.filterType) {
        case FilterType.MARKDOWN:
            query.push('mime:text/markdown');
            break;
        case FilterType.ANY_FILE:
            query.push('-mime:inode/directory');
            break;
        }
         
        try {
            // Call recollq with the user's query
            const results = await this.executeRecollq(query.join(" "));
            if(results.length > 0) {
                if(this.labelsEl) this.labelsEl.style.display = '';
            } else {
                if(this.labelsEl) this.labelsEl.style.display = 'none';
            }
            return results;
        } catch (error) {
            // Recollq failed
            if(this.labelsEl) this.labelsEl.style.display = 'none';
            return [] as RecollResult[];
        }
    }

    private toggleFilter() {
        // Cycle through the filter types
        this.plugin.settings.filterType = (this.plugin.settings.filterType + 1) % 3;
        this.plugin.saveSettings;

        if (!this.filterEl) return;

        // Update the displayed filter message
        this.filterEl.innerText = filter_msg[this.plugin.settings.filterType];
        
        this.updateSuggestions(); 
    }

    private handleKeyDown = (evt: KeyboardEvent) => {
    // Check if the Tab key is pressed
    if (evt.key === 'Tab') {
        evt.preventDefault(); // Prevent the default tab behavior (focus change)
        
        this.toggleFilter();
    }

    // evt.isComposing determines whether the event is part of a key composition
    if (evt.key === 'Enter' && !evt.isComposing && evt.metaKey) {
        this.chooser.useSelectedItem(evt);
    }
}

    createLabels() {
        const labels = document.createElement('div');
        labels.classList.add('prompt-labels');

        const item = document.createElement('div');
        item.classList.add('recoll-search-item');

        const relevanceEl = document.createElement('div');
        relevanceEl.textContent = "Relevance";
        relevanceEl.classList.add('recoll-search-relevance');

        const nameEl = document.createElement('div');
        nameEl.textContent = "Filename";
        nameEl.classList.add('recoll-search-name');

        const createdEl = document.createElement('div');
        createdEl.textContent = "Created";
        createdEl.classList.add('recoll-search-created');

        const modifiedDate = document.createElement('div');
        modifiedDate.textContent = "Modified";
        modifiedDate.classList.add('recoll-search-modified');

        const typeEl = document.createElement('div');
        typeEl.textContent = "Type";
        typeEl.classList.add('recoll-search-type');
        
        const tagsEl = document.createElement('div');
        tagsEl.textContent = "Tags";
        tagsEl.classList.add('recoll-search-tags');

        item.appendChild(relevanceEl);
        item.appendChild(nameEl);
        item.appendChild(createdEl);
        item.appendChild(modifiedDate);
        item.appendChild(typeEl);
        item.appendChild(tagsEl);

        labels.appendChild(item);

        labels.style.display = 'none';
        
        this.modalEl.insertBefore(labels,this.resultContainerEl);

        this.labelsEl = labels;
    }

    onOpen() {
        super.onOpen();
        
        this.containerEl.addEventListener('keydown', this.handleKeyDown);
        
        // remove spell checker from the search field
        this.inputEl.setAttribute('spellcheck', 'false');

        this.inputEl.focus();
        
        this.modalEl.classList.add('recoll-search');

        // Store reference to tab instruction
        if(this.instructionsEl) {
            const filter_idx = 0;
            const filterInstructionEl = this.instructionsEl.children[filter_idx];
            if(filterInstructionEl instanceof HTMLElement) {
                const filterEl = filterInstructionEl.children[1];
                if(filterEl instanceof HTMLElement) {
                    this.filterEl = filterEl;
                }                
            }            
        }

        this.createLabels();
    }

    onClose() {
        this.containerEl.removeEventListener('keydown', this.handleKeyDown);
        super.onClose();
        this.contentEl.empty();
    }

    renderSuggestion(result: RecollResult, el: HTMLElement) {
        el.empty(); // Clear the existing content

        const suggestionContainer = document.createElement('div');
        suggestionContainer.classList.add('recoll-search-item');

        const relevanceEl = document.createElement('div');
        relevanceEl.textContent = result.relevance;
        relevanceEl.classList.add('recoll-search-relevance');

        const nameEl = document.createElement('div');
        nameEl.textContent = result.fileName;
        nameEl.classList.add('recoll-search-name');

        const createdEl = document.createElement('div');
        createdEl.textContent = result.createdDate;
        createdEl.classList.add('recoll-search-created');

        const modifiedDate = document.createElement('div');
        modifiedDate.textContent = result.createdDate;
        modifiedDate.classList.add('recoll-search-modified');

        const typeEl = document.createElement('div');
        typeEl.textContent = result.fileType;
        typeEl.classList.add('recoll-search-type');

        const tagsEl = document.createElement('div');
        tagsEl.classList.add('recoll-search-tags');

        if (result.tags.length>0) {
            const tagsArray = result.tags;
            tagsArray.forEach(tag => {
                if (tag.startsWith('#')) {
                    tag = tag.slice(1); // Remove the first '#' character if it exists
                }

                const tagContainer = document.createElement('div');
                
                const hashtagEl = document.createElement('span');
                hashtagEl.classList.add('cm-formatting', 'cm-formatting-hashtag', 'cm-hashtag', 'cm-hashtag-begin', 'cm-meta', 'cm-tag-Computer');
                hashtagEl.textContent = '#';

                const tagEl = document.createElement('span');
                tagEl.textContent = tag;
                tagEl.classList.add('cm-hashtag', 'cm-meta', 'cm-hashtag-end');

                tagContainer.appendChild(hashtagEl);
                tagContainer.appendChild(tagEl);
                tagsEl.appendChild(tagContainer);
            });
        }

        suggestionContainer.appendChild(relevanceEl);
        suggestionContainer.appendChild(nameEl);
        suggestionContainer.appendChild(createdEl);
        suggestionContainer.appendChild(modifiedDate);
        suggestionContainer.appendChild(typeEl);
        suggestionContainer.appendChild(tagsEl);

        el.appendChild(suggestionContainer);
        // el.createEl("small", { text: `Path: ${result.filePath}, Type: ${result.fileType}` });
    }

    // Perform action on the selected suggestion
    onChooseSuggestion(result: RecollResult, evt: MouseEvent | KeyboardEvent) {
        const absolutePath = result.filePath.slice(7);  // remove the prefix 'file://'

        // Remove the vault path prefix
        const relativePath = absolutePath.startsWith(this.vaultPath)
            ? absolutePath.slice(this.vaultPath.length+1) // +1 to remove the leading '/'
            : absolutePath;

        // Find the file in the vault using Obsidian's API
        const file = this.app.vault.getAbstractFileByPath(relativePath);
        
        if (file instanceof TFile) {
            // Open the file in the current workspace
            this.app.workspace.openLinkText(relativePath, '', true);
        } else {
            new Notice(`File not found in vault: ${result.fileName}`, 5000);
        }
    }

}
