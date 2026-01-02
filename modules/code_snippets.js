// PowerSchool CPM Code Snippets
// This module contains reusable code snippets for PowerSchool development

const CODE_SNIPPETS = {
    box_round: {
        name: 'Box Round Container',
        category: 'Layout',
        description: 'Standard PowerSchool rounded content box',
        content: `<div class="box-round">
    <h2>Your title here...</h2>
    <p>Your content here...</p>
</div>`
    },
    
    calendar: {
        name: 'Date Picker Widget',
        category: 'Forms',
        description: 'PowerSchool date picker input field',
        content: `<input class="psDateWidget" type="date" name="fieldUniqueName" size="11" value="" id="fieldUniqueName" />`
    },
    
    dialog: {
        name: 'Dialog Link',
        category: 'UI',
        description: 'Link that opens content in a dialog window',
        content: `<a title="Dialog title goes here" class="dialog" id="uniqueID" href="contentOfDialogURL.html">Link to open dialog</a>`
    },
    
    dynamic_tabs: {
        name: 'Dynamic Tabs',
        category: 'UI',
        description: 'Tabbed content interface',
        content: `<div class="tabs">
    <ul class="group">
        <li><a href="#tabOneContent">Tab 1</a></li>
        <li><a href="#tabTwoContent">Tab 2</a></li>
        <li><a href="#tabThreeContent">Tab 3</a></li>
    </ul>
    <div id="tabOneContent">
        <p>Content 1 here</p>
    </div>
    <div id="tabTwoContent">
        <p>Content 2 here</p>
    </div>
    <div id="tabThreeContent">
        <p>Content 3 here</p>
    </div>
</div>`
    },
    
    jquery_function: {
        name: 'jQuery Function Block',
        category: 'JavaScript',
        description: 'Standard jQuery function wrapper for PowerSchool',
        content: `<script>
;(function ($) {
    $(function () {
        // Your code goes here ...
    });
})($j);
</script>`
    },
    
    form: {
        name: 'PowerSchool Form',
        category: 'Forms',
        description: 'Standard PowerSchool form with submit button',
        content: `<form action="/admin/changesrecorded.white.html" method="POST">
    <!--content-->
    <div class="button-row">
        <input type="hidden" name="ac" value="prim">
        ~[submitbutton]
    </div>
</form>`
    },
    
    table: {
        name: 'Data Table',
        category: 'Layout',
        description: 'Standards-compliant data table with header and footer',
        content: `<!-- This is a standards driven table. there are no styles, borders, widths and there is a header row-->
<table style="border:0;padding=0;border-collapse:collapse" class="grid" id="tableUniqueID">
    <caption>This text appears above the table</caption>
    <thead>
        <tr>
            <th>H1 content</th>
            <th>H2 content</th>
            <th>H3 content</th>
        </tr>
    </thead>
    <tfoot>
        <tr>
            <td colspan="3">This will display at the bottom of the table. Ideal for legends.</td>
        </tr>
    </tfoot>
    <tbody>
        <tr>
            <td>R1C1 content</td>
            <td>R1C2 content</td>
            <td>R1C3 content</td>
        </tr>
        <tr>
            <td>R2C1 content</td>
            <td>R2C2 content</td>
            <td>R2C3 content</td>
        </tr>
    </tbody>
</table>
<!-- End of table -->`
    },
    
    tlist_sql: {
        name: 'TList SQL Block',
        category: 'PowerSchool',
        description: 'PowerSchool TList SQL query block for dynamic data',
        content: `~[tlist_sql;{query};alternatecolor;nonemessage={none_message}]
{row_template}
[/tlist_sql]`
    },
    
    collapsible_box: {
        name: 'Collapsible Content Box',
        category: 'UI',
        description: 'Expandable/collapsible content container',
        content: `<div class="box-round">
    <h2 class="toggle expanded">Title here</h2>
    <div>
        <p>Content goes here</p>
    </div>
</div>`
    },
    
    // Additional useful PowerSchool snippets
    if_block: {
        name: 'PowerSchool If Block',
        category: 'PowerSchool',
        description: 'Conditional content block using PowerSchool syntax',
        content: `~[if.condition]
    <!-- Content shown when condition is true -->
    <p>Condition is met</p>
[else]
    <!-- Content shown when condition is false -->
    <p>Condition is not met</p>
[/if]`
    },
    
    student_info: {
        name: 'Student Information Tags',
        category: 'PowerSchool',
        description: 'Common PowerSchool student information tags',
        content: `<!-- Student Information -->
Student Name: ~(studentname)
Student Number: ~(student_number)
Grade Level: ~(grade_level)
School: ~(schoolname)
Current Date: ~(curdate)`
    },
    
    breadcrumb: {
        name: 'Navigation Breadcrumb',
        category: 'Navigation',
        description: 'Standard PowerSchool breadcrumb navigation',
        content: `<!-- breadcrumb start -->
<a href="/admin/home.html" target="_top">Start Page</a> &gt; 
<a href="/admin/students/home.html?selectstudent=nosearch" target="_top">Student Selection</a> &gt; 
Your Page Name
<!-- breadcrumb end -->`
    }
};

// Group snippets by category for organized display
const getSnippetsByCategory = () => {
    const categories = {};
    
    Object.keys(CODE_SNIPPETS).forEach(key => {
        const snippet = CODE_SNIPPETS[key];
        const category = snippet.category || 'Other';
        
        if (!categories[category]) {
            categories[category] = [];
        }
        
        categories[category].push({
            key,
            name: snippet.name,
            description: snippet.description,
            category: snippet.category
        });
    });
    
    return categories;
};

// Get all snippets as a flat list
const getAllSnippets = () => {
    return Object.keys(CODE_SNIPPETS).map(key => ({
        key,
        name: CODE_SNIPPETS[key].name,
        description: CODE_SNIPPETS[key].description,
        category: CODE_SNIPPETS[key].category || 'Other'
    }));
};

// Get snippet content by key
const getSnippet = (key) => {
    return CODE_SNIPPETS[key] || null;
};

module.exports = {
    CODE_SNIPPETS,
    getSnippetsByCategory,
    getAllSnippets,
    getSnippet
};