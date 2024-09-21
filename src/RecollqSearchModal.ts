import { App, SuggestModal, Platform, TFile } from 'obsidian';
import { spawn } from 'child_process';
import RecollSearch from 'main';
import { formatUnixTime } from 'utils';
import { FilterType, AltKeyBehavior } from 'types';
import { DEFAULT_SETTINGS } from 'default';

// Interface for Recoll result
interface RecollResult {
    file: TFile;
    fileType: string;
    createdDate: string;
    modifiedDate: string;
    tags: string[];
    relevance: string;
}

const filter_msg = {
    0 : 'only md files',  // MARKDOWN = 0
    1 : 'all files excluding dirs', // ANY_FILE = 1
};

// Store the last query input 
let lastQuery:string = "";

// function get_em_width(parentEl:HTMLElement):number {
//     const tempElement1 = createDiv({cls:'suggestion-item'});
//     const tempElement2 = createDiv({cls:'recoll-search-item'});
//     const tempElement3 = createDiv();
//     tempElement3.textContent = 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM';  // 40 em
//     tempElement2.appendChild(tempElement3);
//     tempElement1.appendChild(tempElement2);
//     parentEl.appendChild(tempElement1); // Append it to the parent element to render it
//     const width = tempElement3.offsetWidth; // Get the width of the rendered text
//     parentEl.removeChild(tempElement1); // Remove the temporary element
//     return width/40.0; // Return the computed width for 1 em
// }

// function getChSizeInPixels(element:HTMLElement) {
//     // Create a temporary element
//     const tempElement = document.createElement('span');
    
//     // Set the text content to '0' and style the element to use 1ch
//     tempElement.textContent = '0';
//     tempElement.style.font = getComputedStyle(element).font; // Apply the same font as the element
//     tempElement.style.width = '1000ch';
//     tempElement.style.position = 'absolute'; // Avoid affecting layout
//     tempElement.style.visibility = 'hidden'; // Make it invisible

//     // Append the element to the body
//     document.body.appendChild(tempElement);

//     // Measure the width of the element
//     const chWidth = tempElement.offsetWidth;

//     // Remove the temporary element
//     document.body.removeChild(tempElement);

//     return chWidth/1000.0;
// }

export class RecollqSearchModal extends SuggestModal<RecollResult> {
    private recollindex_cmd: string;
    private vaultPath: string;
    private vaultPath_length: number;
    private headerEl: HTMLElement | null = null;
    private filterEl: HTMLElement | null = null;

    constructor(app: App, private plugin: RecollSearch, initialQuery?:string) {
        super(app);
        this.setPlaceholder(`Search for files ...`);
        this.setInstructions(this.getInstructionsBasedOnOS());

        // Store the address to recollq cmd
        this.recollindex_cmd = this.plugin.localSettings.recollqCmd;
        this.vaultPath = this.plugin.getVaultPath();
        this.vaultPath_length = this.vaultPath.length;

        if(initialQuery) {
            lastQuery = initialQuery;
        }
    }

    getInstructionsBasedOnOS(): { command: string, purpose: string } [] {
        let altSymbol;
        if (Platform.isMacOS) {
            altSymbol = '⌥';
        } else { // Default to Windows/Linux bindings
            altSymbol = 'Alt';
        }
        let alt_open_msg;
        switch(this.plugin.settings.altKeyBehavior) {
        case AltKeyBehavior.SPLIT:
            alt_open_msg = 'split pane';
            break;
        case AltKeyBehavior.TAB:
            alt_open_msg = 'tab';
            break;
        case AltKeyBehavior.WINDOW:
            alt_open_msg = 'window';
            break;
        }
        return [
            { command: 'Search:', purpose: filter_msg[this.plugin.settings.filterType] },
            { command: 'TAB', purpose: 'switch filter' },
            { command: '↑↓', purpose: 'navigate' },
            { command: "↵", purpose: "open the selected paper" },
            { command: altSymbol, purpose: 'open it in a new ' + alt_open_msg },
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
            // -c <configdir> : specify configuration directory, overriding $RECOLL_CONFDIR.
            const recollq = spawn(this.recollindex_cmd, ['-c', this.plugin.localSettings.recollConfDir, '-F', 'url mtype created modified tags relevancyrating', '-S', 'relevancyrating', query]);

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
                    // console.error(`recollq process exited with code ${code}`);
                    console.error(stderr);
                    return reject(stderr);
                }

                // Get all files in the vault
                // Iterate over fileMap (which is a dictionary of file paths to TAbstractFile instances)
                // Object.keys(this.plugin.app.vault.fileMap).forEach((key: string) => {
                //     const file = this.plugin.app.vault.fileMap[key];
                //     if (file instanceof TFile) {

                //         if(file.path.includes('05 Teaching/E4 Atom und Molekülphysik/2024-04-23 Vorlesungsmitschriften (attachments)/10 OBG Gleichgewichtslösung (22.05.2024).pdf')){
                //             console.log(`KEY: ${key}`);
                //             console.log(key==='05 Teaching/E4 Atom und Molekülphysik/2024-04-23 Vorlesungsmitschriften (attachments)/10 OBG Gleichgewichtslösung (22.05.2024).pdf');
                //             console.log(file);
                //         }
                //     }
                // });

                const results: RecollResult[] = [];

                // Process the output from recollq
                const lines = stdout.trim().split('\n');
                for (const line of lines.slice(2)) {
                    const decodedFields = line.split(' ').map((field:string) => Buffer.from(field, 'base64').toString('utf-8'));
                    // Destructure the decoded fields into individual variables
                    const [url, mtype, created, modified, tags, relevance] = decodedFields;

                    const filePath = url.normalize("NFC").slice(7);  // remove the prefix `file://`

                    if(!filePath.startsWith(this.vaultPath)) {
                        // skip this file that is not in the vault
                        console.error(`Error: filepath '${filePath}' does not start with '${this.vaultPath}'`);
                        continue;
                    }
                    
                    // Remove the vault path prefix
                    const relativeFilePath = filePath.slice(this.vaultPath_length+1) // +1 to remove the leading '/'

                    // Find the file in the vault using Obsidian's API
                    const file = this.app.vault.getAbstractFileByPath(relativeFilePath);

                    if (!(file instanceof TFile)) {
                        // skip this file that is not in the vault
                        console.error(`Error: file '${filePath}' is not found in the vault under '${this.vaultPath}'`);                        
                        continue;
                    }

                    const created_formatted = formatUnixTime(
                        created === "" ? file.stat.ctime : parseInt(created,10)*1000,
                        this.plugin.settings.momentjsFormat);

                    const modified_formatted = formatUnixTime(
                        created === "" ? file.stat.mtime : parseInt(modified,10)*1000,
                        this.plugin.settings.momentjsFormat);

                    results.push({
                        file,
                        fileType: mtype,
                        createdDate:  created_formatted,
                        modifiedDate: modified_formatted,
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
            if(this.headerEl) this.headerEl.style.display = 'none';
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
                if(this.headerEl) this.headerEl.style.display = '';
            } else {
                if(this.headerEl) this.headerEl.style.display = 'none';
            }
            return results;
        } catch (error) {
            // Recollq failed
            if(this.headerEl) this.headerEl.style.display = 'none';
            return [] as RecollResult[];
        }
    }

    private toggleFilter() {
        // Cycle through the filter types
        this.plugin.settings.filterType = (this.plugin.settings.filterType + 1) % Object.keys(filter_msg).length
        this.plugin.debouncedSaveSettings();

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
        if (evt.key === 'Enter' && !evt.isComposing && evt.altKey) {
            this.chooser.useSelectedItem(evt);
        }
    }

    private createHeader() {
        const headerEl = createDiv({cls:['prompt-results','prompt-header']});
        const suggestion_item = createDiv({cls:'suggestion-item'});
        const search_item = createDiv({cls:'recoll-search-item'});
        
        const relevanceEl = createDiv({text:'Score',cls:'recoll-search-score'});
        const nameEl = createDiv({text:'Filename',cls:'recoll-search-name'});        
        const createdEl = createDiv({text:'Created',cls:'recoll-search-created'});
        const modifiedDate = createDiv({text:'Modified',cls:'recoll-search-modified'});
        const typeEl = createDiv({text:'Type',cls:'recoll-search-type'});
        const tagsEl = createDiv({text:'Tags',cls:'recoll-search-tags'});
        
        search_item.appendChild(relevanceEl);
        search_item.appendChild(nameEl);
        search_item.appendChild(createdEl);
        search_item.appendChild(modifiedDate);
        search_item.appendChild(typeEl);
        search_item.appendChild(tagsEl);

        suggestion_item.appendChild(search_item);
        headerEl.appendChild(suggestion_item);

        headerEl.style.display = 'none';

        this.modalEl.insertBefore(headerEl,this.resultContainerEl);

        // const chSizeInPixels = getChSizeInPixels(modifiedDate);
        // const max_num_chars = this.modalEl.innerWidth/chSizeInPixels;
        // if(max_num_chars < 160) {
        //     document.documentElement.style.setProperty('--recoll-search-extra', 'none');
        // }

        this.headerEl = headerEl;
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

        // Set the width of the date fields computed using the date format provided by the user
        const mock_date = formatUnixTime(1726414358942,this.plugin.settings.momentjsFormat);
        document.documentElement.style.setProperty('--recoll-search-date', `${mock_date.length}ch`);

        // Create header for the table of results
        this.createHeader();

        
        // Use the last query
        this.inputEl.value = lastQuery;
        this.updateSuggestions(); 
    }

    onClose() {
        lastQuery = this.inputEl.value;
        this.containerEl.removeEventListener('keydown', this.handleKeyDown);
        super.onClose();
        this.contentEl.empty();
    }

    renderSuggestion(result: RecollResult, el: HTMLElement) {
        el.empty(); // Clear the existing content

        const suggestionContainer = createDiv({cls:'recoll-search-item'});
        
        const relevanceEl = createDiv({text:result.relevance,cls:'recoll-search-score'})
        
        const nameEl = createDiv({cls:'recoll-search-name'});
        const filenameEl = createDiv({text:result.file.name});
        const parentEl = createEl('small',{
            text:result.file.path.slice(0,result.file.path.lastIndexOf('/'))
        });
        nameEl.appendChild(filenameEl);
        nameEl.appendChild(parentEl);
        
        const createdEl = createDiv({text:result.createdDate,cls:'recoll-search-created'});
        const modifiedDate = createDiv({text:result.modifiedDate,cls:'recoll-search-modified'});
        const typeEl = createDiv({text:result.fileType,cls:'recoll-search-type'});
        const tagsEl = createDiv({cls:'recoll-search-tags'});

        if (result.tags.length>0) {
            const tagsArray = result.tags;
            tagsArray.forEach(tag => {
                if (tag.startsWith('#')) {
                    tag = tag.slice(1); // Remove the first '#' character if it exists
                }

                const tagContainer = document.createElement('div');
                
                const hashtagEl = createSpan({
                    cls:['cm-formatting', 'cm-formatting-hashtag', 'cm-hashtag', 'cm-hashtag-begin', 'cm-meta', 'cm-tag-Computer'],
                    text:'#'
                });
                
                const tagEl = createSpan({text:tag,cls:['cm-hashtag', 'cm-meta', 'cm-hashtag-end']});

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
    }

    // Perform action on the selected suggestion
    onChooseSuggestion(result: RecollResult, evt: MouseEvent | KeyboardEvent) {
        const shouldCreateNewLeaf = evt.altKey; // alt key pressed

        let leaf = this.app.workspace.getMostRecentLeaf();
        if (shouldCreateNewLeaf || (leaf && leaf.getViewState().pinned)) {
            let default_behavior = DEFAULT_SETTINGS.altKeyBehavior;
            switch(this.plugin.settings.altKeyBehavior){
            case AltKeyBehavior.SPLIT:
                default_behavior = AltKeyBehavior.SPLIT;
                break;
            case AltKeyBehavior.TAB:
                default_behavior = AltKeyBehavior.TAB;
                break;
            case AltKeyBehavior.WINDOW:
                default_behavior = AltKeyBehavior.WINDOW;
                break;
            }
            leaf = this.app.workspace.getLeaf(default_behavior);
        }
        if (leaf) {
            // this.app.workspace.openLinkText(relativePath, '', true);
            leaf.openFile(result.file);
        } else {
            console.error("Error in creating a leaf for the file to be opened:", result.file.name);
        }
    }
}
