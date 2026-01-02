// PowerSchool CPM File Templates
// This module contains all file templates for creating new PowerSchool pages

const FILE_TEMPLATES = {
    // Admin Templates
    admin: {
        name: 'Admin Page',
        extension: '.html',
        category: 'Admin',
        description: 'General admin page template',
        content: `<!--
TemplateName:Admin
-->
<!DOCTYPE html>
<html>
<head>
	<title>New Admin Page</title>
<!-- required scripts -->
	~[wc:commonscripts] 
<!-- Required style sheets: screen.css, and print.css --> 
	<link href="/images/css/screen.css" rel="stylesheet" media="screen">
	<link href="/images/css/print.css" rel="stylesheet" media="print">
</head> 
<body> 
	~[wc:admin_header_css] 
    <!-- breadcrumb start -->New Admin Page<!-- breadcrumb end --> 
<!-- start of main menu and content --> 
	~[wc:admin_navigation_css] 
<!-- Start of Page --> 
	<h1>New Admin Page</h1> 
<!-- start of content area --> 
	<div class="box-round"> 
		 <h2>Section Title Text Goes Here</h2> 
		 <p> 
		 	Your paragraph text goes here.
		 </p> 
	</div> 
<!-- end of content area --> 
	~[wc:admin_footer_css] 
</body> 
</html>`
    },
    
    adminStudentPage: {
        name: 'Admin Student Page',
        extension: '.html',
        category: 'Admin',
        description: 'Admin page for student-specific functions',
        content: `<!--
TemplateName:Admin Student Page
-->
<!DOCTYPE html>
<html>
<head>
	<title>New Student Page</title>
<!-- required scripts -->
	~[wc:commonscripts] 
<!-- Required style sheets: screen.css, and print.css -->
	<link href="/images/css/screen.css" rel="stylesheet" media="screen">
	<link href="/images/css/print.css" rel="stylesheet" media="print">
</head> 
<body> 
	~[wc:admin_header_frame_css]
	<!-- breadcrumb start -->
		<a href="/admin/home.html" target="_top">Start Page</a> &gt; <a href="/admin/students/home.html?selectstudent=nosearch" target="_top">Student Selection</a> &gt; New Student Page
	<!-- breadcrumb end -->
~[wc:admin_navigation_frame_css]
<!-- start of main menu and content -->
~[wc:title_student_begin_css]New Student Page~[wc:title_student_end_css]
<form action="/~[self.page]?frn=~(studentfrn)&changesSaved=true" method="POST">
<!-- start of content area -->
~[if.~(gpv.changesSaved)=true]<div class="feedback-confirm">~[text:psx.common.changes_recorded]</div>[/if]
	<div class="box-round">
		 <h2>Section Title Text Goes Here</h2>
		 <p>
		 	Your paragraph text goes here.
		 </p>
        <div class="button-row"><input type="hidden" name="ac" value="prim">~[submitbutton]</div>
	</div>
</form>
<!-- end of content area -->
	~[wc:admin_footer_frame_css]
</body> 
</html>`
    },

    // Teacher Templates
    teacher: {
        name: 'Teacher Page',
        extension: '.html',
        category: 'Teacher',
        description: 'General teacher page template',
        content: `<!--
TemplateName:Teacher
-->
<!DOCTYPE html>
<html>
<head>
	<title>New Teacher Page</title>
<!-- required scripts -->
	~[wc:commonscripts] 
<!-- Required style sheets: screen.css, and print.css -->
	<link href="/images/css/screen.css" rel="stylesheet" media="screen">
	<link href="/images/css/print.css" rel="stylesheet" media="print">
</head> 
<body> 
~[wc:teachers_header_css] 
~[wc:teachers_navigation_css] 
<!-- sets active navigation tab --> 
~[SetPostValue:tabname=home] 
~[wc:teachers_nav_css] 
	<h1>New Teacher Page</h1> 
	<form name="navigation"> 
<!-- start of content area --> 
	<div class="box-round"> 
		 <h2>New Teacher Page</h2> 
		 <p> 
		 	Your paragraph text goes here. 
		 </p> 
	</div> 
<!-- end of content area --> 
~[wc:teachers_footer_css]
</body> 
</html>`
    },

    teacherBackpack: {
        name: 'Teacher Backpack Page',
        extension: '.html',
        category: 'Teacher',
        description: 'Teacher backpack (student-specific) page template',
        content: `<!--
TemplateName:Teacher Backpack
-->
<!DOCTYPE html>
<html>
<head>
	<title>New Teacher Backpack Page</title>
<!-- required scripts -->
	~[wc:commonscripts] 
<!-- Required style sheets: screen.css, and print.css -->
	<link href="/images/css/screen.css" rel="stylesheet" media="screen">
	<link href="/images/css/print.css" rel="stylesheet" media="print">
<script type="text/javascript">
	<!-- Begin
	function formHandler(form){
	var URL = document.navigation.page.options[document.navigation.page.selectedIndex].value;
	window.location.href = URL;
	}
	// End -->
</script>
</head>
<body>

~[wc:teachers_header_fr_css]

 <form name="navigation"><span class="account-photo">~[studenttitlephoto]</span>
 <h1>New Teacher Backpack Page<span class="nav-teacher"><select name="page" size=1 onChange="javascript:formHandler()"><option value="">Select Screens</option><option value="">--------------------</option>~[x:teacherpages]</select></span>~[studentalert]</h1>
<p>~(studentname) &nbsp; ~(grade_level) &nbsp; ~(student_number) &nbsp; &nbsp; ~(track) &nbsp; &nbsp; ~(studschoolabbr) &nbsp; &nbsp; ~[enrollmentstatus]</p></form>

	<div class="box-round">
		 <p>
		 	Your paragraph text goes here.
		 </p>
	</div>
<!-- end of content area -->
~[wc:teachers_footer_fr_css]
</body>
</html>`
    },

    // Parent/Guardian Templates
    parentPortal: {
        name: 'Parent Portal Page',
        extension: '.html',
        category: 'Parent',
        description: 'Parent/Guardian portal page template',
        content: `<!--
TemplateName:Parent Portal
-->
<!DOCTYPE html>
<html>
<head>
  <title>New Parent Page</title>
<!-- start of page body --> 
~[wc:guardian_header] 
	<h1>New Parent Page</h1> 
<!-- start student content --> 
	<div class="box-round"> 
		<h2>Section title goes here</h2> 
		<p>Your paragraph text goes here</p> 
	</div> 
<!-- end student content --> 
<!-- Sets the navigation highlighting: the value is the ID value of the navigation element you want to highlight--> 
<input id="activeNav" type="hidden" value="#btn-gradesAttendance"/> 
<!-- end of page body --> 
~[wc:guardian_footer] 
</body> 
</html>`
    }
};

// Group templates by category for organized display
const getTemplatesByCategory = () => {
    const categories = {};
    
    Object.keys(FILE_TEMPLATES).forEach(key => {
        const template = FILE_TEMPLATES[key];
        const category = template.category || 'Other';
        
        if (!categories[category]) {
            categories[category] = [];
        }
        
        categories[category].push({
            key,
            name: template.name,
            description: template.description,
            extension: template.extension
        });
    });
    
    return categories;
};

// Get all templates as a flat list
const getAllTemplates = () => {
    return Object.keys(FILE_TEMPLATES).map(key => ({
        key,
        name: FILE_TEMPLATES[key].name,
        description: FILE_TEMPLATES[key].description,
        category: FILE_TEMPLATES[key].category || 'Other',
        extension: FILE_TEMPLATES[key].extension
    }));
};

// Get template content by key
const getTemplate = (key) => {
    return FILE_TEMPLATES[key] || null;
};

module.exports = {
    FILE_TEMPLATES,
    getTemplatesByCategory,
    getAllTemplates,
    getTemplate
};