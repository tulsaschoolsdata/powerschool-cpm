var currentlyloadingfile=0;

/**
 * Open Close Directorys
 * 
 * @param li[item=directory] div div  jquery element for the directory
 * @param string options are collapse or expand which overrides exisiting behavior
 */
function openCloseDir(element,force){
    if(force===undefined){
        if(element.hasClass("directory-expanded") ||element.hasClass("directory-subCustom-expanded") ||element.hasClass("directory-custom-expanded")){
            force="collapse";   
        }else{
            force="expand";
        }
    }
    switch(force){
        case "collapse":
            element.closest("li").children("ul").addClass("hide");
            if(element.hasClass("directory-collapsed") || element.hasClass("directory-expanded")){
                element.removeClass("directory-expanded"); 
                element.addClass("directory-collapsed");
            }
            if(element.hasClass("directory-subCustom-expanded") || element.hasClass("directory-subCustom-collapsed")){
                element.removeClass("directory-subCustom-expanded");
                element.addClass("directory-subCustom-collapsed");
            }
            if(element.hasClass("directory-custom-expanded") || element.hasClass("directory-custom-collapsed")  ){
                element.removeClass("directory-custom-expanded");
                element.addClass("directory-custom-collapsed");
            }
            break;
        case "expand":
             element.closest("li").children("ul").removeClass("hide");
            if(element.hasClass("directory-collapsed") || element.hasClass("directory-expanded") ){
                element.removeClass("directory-collapsed");
                element.addClass("directory-expanded");
            }
            if(element.hasClass("directory-subCustom-expanded") || element.hasClass("directory-subCustom-collapsed") ){
                element.removeClass("directory-subCustom-collapsed");
                element.addClass("directory-subCustom-expanded");
            }
            if(element.hasClass("directory-custom-expanded") || element.hasClass("directory-custom-collapsed")  ){
                element.removeClass("directory-custom-collapsed");
                element.addClass("directory-custom-expanded");
            }
            break;
        default:
    }
}
/**
 * Open directory and all parent directories
 */
function goToSelectedDirectory(){
    if($("li div.selected").length>0){
         $("li[item-type=directory]").has("li div.selected").each(function(){
	        $(this).removeClass("hide");
	        openCloseDir($(this).children("div").children("div"),"expand");
	    });
    }
}
/**
 * Create file tree
 * @param json the json sent from Pearson CPM
 * @param string the path where to start
 * @param int how many levels deep
 * 
 * @return json with Root as the element and custom to indicate if it contains custom files
 */
function menu(json,path,level){
    var pageFragments=[
        "content.header",
        "content.footer",
        "leftnav.footer",
        "page.header",
        "report.tabs",
        "student.alert"
    ];
    pageFragmentTest=new RegExp("("+pageFragments.map(function(d){ return d.replace(".","\\.")+"\\.txt";}).join("|")+")$",i);
    
	var root=$("<ul></ul>");			
	if(level>0){
	    root.addClass('hide');
	}

	var subCustom=false;
	if(json.subFolders.length>0){
	    //sort folders alphabetically
		json.subFolders.sort(function(a,b){
		   return a.text.toUpperCase()>b.text.toUpperCase()?1:-1; 
		});
		//cycle to the folders and create the li element
		for(var i=0;i<json.subFolders.length;i++){
		    var item=$("<li></li>");
		    item.attr("search-status",true);
		    item.attr("item-type","directory");
		    var div=$("<div></div>");
		    var imageDiv=$("<div></div>");
		    level++;
		    //recursively load any sub folder contents
		    var submenu=menu(json.subFolders[i],path+"/"+json.subFolders[i].text,level);
		    var dirClass="";
		    if(json.subFolders[i].custom){
		        dirClass="directory-custom-collapsed";
		    }else{
		        if(submenu.custom){
		            subCustom=true;
		            item.attr("item-subcustom",true);
		            dirClass="directory-subCustom-collapsed";
		        }else{
		            item.attr("item-subCustom",false);
		            dirClass="directory-collapsed";
		        }
		    }
		    //set if custom 
		    if(json.subFolders[i].custom){
		        item.attr('item-custom','true');
		    }else{
    		    item.attr('item-custom','false');
    		}
		    item.attr("item-name",json.subFolders[i].text);
    		imageDiv.addClass(dirClass);
    		div.append(imageDiv);
		    div.html(div.html()+json.subFolders[i].text);
		    item.append(div);
		    //set parent path
		    var parentPath=path.toLowerCase();
		    item.attr("item-path",parentPath);
		    if(json.subFolders[i].custom){
		        item.addClass("subCustom");
		        subCustom=true;
		    }else{
		        item.addClass("");
		    }
		    item.append(submenu.element);
		    root.append(item);
		}
	}
	//create pages
	if(json.pages.length>0){
	    json.pages.sort(function(a,b){
		   return a.text.toUpperCase()>b.text.toUpperCase()?1:-1; 
		});
    	for(var i=0;i< json.pages.length;i++){
    		var item=$("<li></li>");
    		item.attr("search-status",true);
    		var div=$("<div></div>");
    		item.attr("item-type","file");
    		item.attr("item-name",json.pages[i].text);
    		var imageDiv=$("<div></div>");
    		var fileparts=json.pages[i].text.split(".");
    		//extract file extension
    		var ext="file";
    		if(fileparts.length>1){
    		    ext=fileparts[fileparts.length-1];
    		}
    		
    		
    		if(pageFragmentTest.test(json.pages[i].text)){
    		    item.attr("item-pageFragement",true);
    		}else{
    		    item.attr("item-pageFragement",false);
    		}
    		
    		
    		
    		imageDiv.addClass("file");
    		imageDiv.addClass(ext);
    		div.append(imageDiv);
    		//var parentPath=(json.pathToParent!==null)?json.pathToParent.toLowerCase():"";
		    item.attr("item-path",path.toLowerCase());
		    item.attr("item-name",json.pages[i].text);
	        div.html(div.html()+item.html()+json.pages[i].text);
    		if(json.pages[i].custom){
    			item.attr("item-custom","true");
    			subCustom=true;
    		}else{
				item.attr("item-custom",'false');
			}
    		item.append(div);
    		root.append(item);
    	}
	}
	if(root===$("<ul></ul>")){
	    root=null;
	}
	return {"element":root, "custom":subCustom};
}
/**
 * Show all files in the directory
 * 
 * @param jquery object 
 */ 
function unhideContents(directory){
    $(directory).children("li").removeClass('hide');
    $(directory).children("li").each(function(){
        if($(this).children("ul").length>0){
            unhideContents($(this).children('ul'));
        }
    });
}
/**
 * Create right click menus for the file tree
 */ 
function createContextMenus(){
    //create file right click menu
    $.contextMenu({
        selector: 'li[item-type=file]', 
        delay: 500,
        animation: {duration: 10, show: 'show', hide: 'hide'},
        events:{
            show: function(opt){ 
                $("li div.selected").removeClass('selected');
                $(this[0]).children("div").addClass('selected');
            }
        },
        items: {
            "createFile": {
                name: "Create File",
                callback:function(key,opt){
                    var message="Do not use any spaces and it must end with a file extension of html,cc,json, and js.";
                    $("#new p.validateTips").html(message);
                    $("#new" ).dialog("open");
                    $("#newAssetType").val("file");
                    $("#newAssetPath").val($($(this)[0]).attr('item-path'));
                    $("#new").dialog("open");
                }
            },
            "deleteFile": {
                name: "Delete File",
                callback:function(key,opt){
                    var path=$($(this)[0]).attr('item-path')+"/"+$($(this)[0]).attr('item-name');
                    console.log("delete file:"+path);
                    deleteFile(path,$($(this)[0]));
                    return true;
                }
            },
            "loadOriginal":{
                name:"View Original",
                callback:function(key,opt){
                    path=$($(this)[0]).attr('item-path');
                    filename=$($(this)[0]).attr('item-name');
                    loadFile(path,filename,true,"original");
                }
            },
            "compareOriginal":{
                name:"Compare Original",
                callback:function(key,opt){
                    path=$($(this)[0]).attr('item-path');
                    filename=$($(this)[0]).attr('item-name');
                    loadFile(path,filename,true,"compare",-1);
                }
            }/*,
            "seeVersions":{
                name:"See Version",
                callback:function(key,opt){
                    path=$($(this).context).attr('item-path');
                    filename=$($(this).context).attr('item-name');
                    $("#versionPath").val(path);
                    $("#versionFileName").val(filename);
                    custom=$("#versionCustom").val("true");
                    loadVersions(filename,path);
                }
            }*/
            
        }
    });
    function removeItemFromTree(item){
        $(item).remove();
        toastr.success(item.attr('item-path')+"/"+item.attr('item-name')+' Deleted');
    }
    // create directory right click menu
     $.contextMenu({
        selector: 'li[item-type=directory]', 
        events:{
            show: function(opt){ 
                
                $("li div.selected").removeClass('selected');
                $(this[0]).children("div").addClass('selected');
            }
        },
        items: {
            "refresh": {
                name: "Refresh",
                callback:function(key,opt){
                    refreshDirectory($($(this)[0]));
                    return true;
                }
            },
            "createFile": {
                name: "Create File",
                callback:function(key,opt){
                    $("#new").dialog("option","title","New File");
                    var message="Do not use any spaces and it must end with a file extension of txt, html , htm, js, javascript, json, css, rpt, xml, text, csv, tsv, or ftl.";
                    $("#new p.validateTips").html(message);
                    $("#new" ).dialog("open");
                    $("#newAssetType").val("file");
                    $("#newAssetPath").val($($(this)[0]).attr('item-path')+"/"+$($(this)[0]).attr('item-name'));
                    $("#new").dialog("open");
                }
            },
            "createDirectory": {
                name: "Create Directory",
                callback:function(key,opt){
                    $("#new").dialog("option","title","New Directory");
                    var message="";
                    $("#new p.validateTips").html(message);
                    $("#newAssetType").val("folder");
                    $("#newAssetPath").val($($(this)[0]).attr('item-path')+"/"+$($(this)[0]).attr('item-name'));
                    $("#new").dialog("open");
                }
            },
            "deleteDirectory": {
                name: "Delete",
                callback:function(key,opt){
                    //get the directory to work in
                    var directory=$($(this)[0]);
                    var containingItems=directory.find("li[item-custom=true]");
                    
    	            var img=$("<img />").attr("src","images/ajax-loader.gif").css("float","right").css("margin-right","7px");
                    //Check to see if the folder contains any items.
                    if(containingItems.length>0){
                        //Confirm that this is okay
                        if(confirm("There are "+containingItems.length+" custom files/directories contained in this folder. Are you sure you want to delete them all? There is no undo.")){
                            
    	                    $(directory.find("div div")[0]).prepend(img);
                            $.ajax(urlDeleteFolder,{
                                method:"POST",
                                data:{
                                    forceDelete:"true",
                                    path:"/"+directory.attr('item-path')+"/"+directory.attr('item-name')
                                },
                                success:function(data){
                                    removeItemFromTree(directory); 
                                }
                            });
                        }
                    }else{
    	                $(directory.find("div div")[0]).prepend(img);
                        //Contains no files you are free to delete.
                        $.ajax(urlDeleteFolder,{
                            method:"POST",
                            data:{
                                forceDelete:"true",
                                path:"/"+directory.attr('item-path')+"/"+directory.attr('item-name')
                            },
                            success:function(data){
                                removeItemFromTree(directory);
                            }
                        });
                    }
                }
            },
            "expandAll":{
                name:"Expand All",
                callback:function(key,opt){
                    $("div.selected").closest("li").find("li[item-type='directory']")
                        .add($("div.selected").closest("li"))
                        .each(function(){
                            openCloseDir($(this).children("div").children("div"),"expand");
                    });
                }
            },
            "collapseAll":{
                name:"Collapse All",
                callback:function(key,opt){
                    $("div.selected").closest("li").find("li[item-type='directory']")
                        .add($("div.selected").closest("li"))
                        .each(function(){
                            openCloseDir($(this).children("div").children("div"),"collapse");
                    });
                }
            },
            "uploadFile": {
                name: "Upload File",
                callback:function(key,opt){
                    $("#uploadDia").dialog("option","title","Upload File");
                    $("#pathLabel").html($($(this)[0]).attr('item-path')+"/"+$($(this)[0]).attr('item-name'));
                    $("#fileUploadForm_filePath").val("/"+$($(this)[0]).attr('item-path')+"/"+$($(this)[0]).attr('item-name'));
                    $("#uploadDia").dialog("open");
                }
            },
        }
    });
}

/***
 * Refresh the Directory
 * 
 * @param UL The JQuery object of the directory to refresh
 * 
 */
function refreshDirectory(root){
	fullpath=$(root).attr("item-path")+"/"+$(root).attr("item-name");
	$(root).children("ul").remove();
	baseElement=$(root);
	
	var parameters=[
	    {"name":"maxDepth","value":"999"},
	    {"name":"rnd","value":Math.random()},
	    {"name":"path","value":fullpath}
	];
	if($(baseElement.find("div div")[0]).children("img").length===0){
    	var img=$("<img />").attr("src","images/ajax-loader.gif").css("float","right").css("margin-right","7px");
    	$(baseElement.find("div div")[0]).prepend(img);
	}
    $.ajax(urlTree,{
		data:parameters,
		success:function(data,status,jxhr){
            if(!(checkReturnData(data))){
                var success={
        	        callback:refreshDirectory,
        	        parameter:[root]
        	    };
        	    loggin(success);
                
            }else{
    			var directoryJson=menu(data.folder,fullpath,0);
    			if(directoryJson.element!==null){
    			    baseElement.append(directoryJson.element);
    			}
    			var div=$($(baseElement.children("div")[0]).children("div")[0]);
    			openCloseDir(div,"expand");
    			$(baseElement.find("div div")[0]).children("img").remove();
    			assignPluginInfo();
    			filterFiles()
            }
		},
		failure:function(data){
			alert("failure");
		}
	});	
}

/**
 * @param string ID of the where the navigation tree will be
 */
function createFileTree(baseElement){
    
	baseElement=$(baseElement);
	$("#navigation").addClass("masked");
	var parameters=[{"name":"maxDepth","value":"99"},{"name":"rnd","value":Math.random()}];
	
    $.ajax(urlTree,{
		dataType:"json",
		data:parameters,
		success:function(data){
			var directoryJson=menu(data.folder,"",0);
			baseElement.html(directoryJson.element);
	        $("#navigation").removeClass("masked");
	        initialFile();
	        assignPluginInfo();
		},
		failure:function(data){
			alert("failure");
		}
	});	
	$("span.deleteicon span").off('click').on('click',function() {
        $(this).prev('input').val('').focus();
        filterFiles();
    });
	

} 

function filterFiles(){
    var fileTreeId="fileTree";
    var showAll=true;
    var openDirectories=false;
    //zero diplay nothing
    $("#"+fileTreeId+" li").attr("display-status",false);
    //first check plugins
    var pluginId=$("#plugin option:checked").val();
    var currentSet=$("#"+fileTreeId+" li");
    if(pluginId!==""){
        currentSet=$("#"+fileTreeId+" li[plugin-id="+pluginId+"]").attr("display-status",true);
        showAll=false;
    }
    //second check custom fields
    if($("#showCustomOnly").is(':checked')){
        currentSet.filter("[item-custom=false]").attr("display-status",false);
        currentSet=currentSet.filter("[item-custom=true]").attr("display-status",true);
        showAll=false;
    }
    //last check searching
    
    if($("#searchInput").val().length>0){
	    var query=new RegExp($("#searchInput").val(),"i");
	    openDirectories=true;
        currentSet.each(function(){
	       if($(this).attr("item-name").search(query)>-1){
	           $(this).attr("display-status",true);
	       }else{
	           $(this).attr("display-status",false);
	       }
	    });
	    showAll=false;
    }
    if(showAll){
        $("#fileTree li").attr("display-status",true);
    }else{
        //if a directory has search-status=true then show all children and open folder
        $("#fileTree li[display-status=true][item-type=directory]").find("li").attr("display-status",true);
    
        //expand directories
        $("#fileTree li[item-type=directory]").has("li[display-status=true]").each(function(){
            $(this).attr("display-status",true);
            if(openDirectories){
                openCloseDir($(this).children("div").children("div"),'expand');
            }
        });
    }
    //$("#fileTree li[display-status=false] div.selected").removeClass('selected');
    if($("#fileTree li[display-status=true] div.selected").length>0){
        moveToSelectedItem();
    }
}




/**
 * Create tab and load file editor
 * @param string path to file
 * @param string file name
 * @param bool true if custom else otherwise
 * @param bool true to load original file, (default) false/blank
 * 
 */
function loadFile(path,filename,custom,type,versionId){
    if(type===undefined){
        type="normal";
    }
    var fullpath=(path=="/")?"/"+path+filename:"/"+path+"/"+filename;
    var parameter=[
        {"name":"path","value":fullpath},
        {"name":"LoadFolderInfo","value":false},
        {"name":"rnd","value":Math.random()*1E16}
    ];
    var fileparts=filename.split(".");
    var ext=null
    if(fileparts.length>1){
        ext=fileparts[fileparts.length-1];
    }
    var createTabLoadFile=function(){
        let tabNumber=$("#openFiles ul li").length+1+currentlyloadingfile;
        currentlyloadingfile++;
        while($("#openFiles ul li a[href='#tab-"+tabNumber+"']").add("#tab-"+tabNumber).length>0){
            tabNumber++;
        }
        let tabName="tab-"+tabNumber;
        let fileLabel=type=="original"?filename+" (original)":filename;
        let a=$("<a></a>").attr({"href":"#"+tabName,
                                "file":type=="original"?fullpath.replace(/(\/|\.)/g,"")+"original":fullpath.replace(/(\/|\.)/g,""),
                                "title":fullpath,
                                "status":"original"}).html(fileLabel);
        a.append("<span class='ui-icon ui-icon-close' role='presentation'>Remove Tab</span>");
        let li=$("<li></li>").attr({"file":filename,
                                    "path":path,
                                    "file-id":type=="original"?fullpath.replace(/(\/|\.)/g,"")+"":fullpath.replace(/(\/|\.)/g,""),
                                    "custom":custom
        });
        li.append(a); 
        if(ext=="png" || ext=="gif" || ext=="jpeg" || ext=="jpg"|| ext=="ico"){
             $("#openFiles ul").append(li);
            var editor=$("<div></div>").attr("id",tabName+"-editor").attr("editor",false);
            var contents=$("<div></div>").attr("id",tabName);
            contents.append(editor);
            var tabs=$("#openFiles").append(contents).tabs( "refresh" );
            editor.height($(window).height()-$("#editorButtonSet").height()-$("#container").height()-$("ul[role=tablist]").outerHeight(true)-40);
            editor.append("<img src="+fullpath+" />");
            editor.css("overflow","auto");
            $("#editor").width($(window).width()-$("#navigation").outerWidth(true)-18);
            $("#openFiles").tabs("option","active",$("#openFiles ul li").length-1);
        }else{
            var theme=$("#theme option:selected").val()!==""?$("#theme option:selected").val():undefined;
            $.ajax(urlRetrieveData,{
                data:parameter,
                success:function(data,status,jxhr){
                    dataType=typeof(data);
                    if(!(checkReturnData(data))){
                        var success={
                	        callback:loadFile,
                	        parameter:[path,filename,custom]
                	    };
                	    loggin(success);
                    }else{
                        //Append the tab
                        $("#openFiles ul").append(li);
                            //set the variables
                            var fileparts=filename.split(".");
                            var ext="file";
                            if(fileparts.length>1){
                            ext=fileparts[fileparts.length-1];
                        }
                        switch(ext){
                            case "html":
                                var mode="ace/mode/html";
                                break;
                            case "js":
                                var mode="ace/mode/javascript";
                                break;
                            case "xml":
                                var mode="ace/mode/xml";
                                break;
                            case "css":
                                var mode="ace/mode/css";
                                break;
                            case "txt":
                                var mode="ace/mode/html";
                                break;
                            case "json":
                                var mode="ace/mode/json";
                                break;
                            default:
                                var mode="ace/mode/html";
                        }
                        var editorSetting={
                          "mode":mode,
                          "theme":theme,
                          "link":a
                        };
                		let editor=$("<div></div>").attr("id",tabName+"-editor");
                        let tabContents=$("<div></div>").attr("id",tabName);
                        let tabs=$("#openFiles").append(tabContents).tabs( "refresh" );
                        $("#openFiles").tabs("option","active",$("#openFiles ul li").length-1);
                        let currentHeight=$(window).height()-$("#editorButtonSet").height()-$("#container").height()-$("ul[role=tablist]").outerHeight(true)-40
                        editor.height(currentHeight);
                        let aceEditor;
                        switch(type){
                            case "original":
                                editor.attr("editor",false);
                                if(data.builtInText.search("is not available")>-1){
                                    editor.text("");
                                }else{
                                    editor.text(data.builtInText);
                                }
                                tabContents.append(editor);
                                aceEditor = ace.edit(tabName+"-editor");
                                aceEditor.setReadOnly(true);
                                setupBasicEditor(aceEditor,editorSetting);
                                break;
                            case "compare":
                                if(custom){
                                   if(data.activeCustomContentId===0 || data.activeCustomContentId===null){
                                       customContentId=data.versionAssetContentIds[0];
                                   }else{
                                       customContentId=data.activeCustomContentId;
                                   }
                                    li.attr("customContentId",customContentId);
                                }else{
                                    li.attr("customContentId",-1);
                                }
                                editor.attr("editor",true);
                                var compareContainer=$("<div />").addClass("compare");
                                var gutter=$("<div />").attr('id',tabName+"-gutter").addClass('gutter');
                                var compareToEditor=$("<div />").attr("id",tabName+"-editor-compare");
                                compareContainer.append(editor).append(gutter).append(compareToEditor);
                                //Set current Contents
                                if(data.activeCustomText==null){
                                   if(data.builtInText.search("is not available")>-1){
                                       currentText="";
                                    }else{
                                        currentText=data.builtInText;
                                    }
                                    
                                }else{
                                   currentText=data.activeCustomText;
                                }
                                //Set original Contents
                                if(versionId==-1){
                                    var compareText=data.builtInText
                                }else{
                                    var url="versionContents.html"
                                    $.ajax(url,{
                                       async:false,
                                       data:"id="+versionId,
                                       success:function(data){
                                           compareText=data;
                                       },
                                       failure:function(){
                                           alert("Problem loading file version");
                                       }
                                       
                                    });
                                }
                                if(compareText.search("is not available")>-1){
                                   compareText="";
                                }
                                compareContainer.addClass("compare");
                                tabContents.append(compareContainer);
                                let differ = new AceDiff({
                                    mode: mode,
                                    diffGranularity:"broad",
                                    left: {
                                        id: tabName+"-editor",
                                        content:currentText
                                    },
                                    right: {
                                        id: tabName+"-editor-compare",
                                        content:compareText,
                                        editable:false
                                    },
                                    classes:{
                                        gutterID:tabName+"-gutter"
                                    }
                                });
                                
                                 aceEditor = ace.edit(tabName+"-editor");
                                setupBasicEditor(aceEditor,editorSetting);
                                $(window).trigger("resize");
                                break;
                            case "normal":
                                editor.attr("editor",true);
                                if(custom){
                                   if(data.activeCustomText==null){
                                       if(data.builtInText.search("is not available")>-1){
                                           editor.text("");
                                       }else{
                                            editor.text(data.builtInText);
                                       }
                                   }else{
                                            editor.text(data.activeCustomText);   
                                   }
                                   if(data.activeCustomContentId===0 || data.activeCustomContentId ===null){
                                       if(data.versionAssetContentIds[0]===undefined){
                                           customContentId=-1;
                                       }else{
                                           customContentId=data.versionAssetContentIds[0];
                                       }
                                   }else{
                                       customContentId=data.activeCustomContentId;
                                   }
                                    li.attr("customContentId",customContentId);
                                }else{
                                    editor.text(data.builtInText);
                                    $(li[0]).attr("customContentId",-1);
                                }
                                tabContents.append(editor);
                                let aceEditor = ace.edit(editor[0]);
                                setupBasicEditor(aceEditor,editorSetting);
                                aceEditor.resize(true);
                                break;
                                
                        }
                        savePrefs();
        	            //$("#editor").width($(window).width()-$("#navigation").outerWidth(true)-18);
                    }
                    currentlyloadingfile--;
                },
                failure:function(data){
                    alert("Failed to load File");
                }
            });
        }
    };
    var fileid=type=="original"?fullpath.replace(/(\/|\.)/g,"")+"original":fullpath.replace(/(\/|\.)/g,"");
    if($("#openFiles ul li[file-id="+fileid+"]").length>0){
        var isFileOpen=true;
        var matchedOpenFiles=$("#openFiles ul li[file-id="+fileid+"]");
    }else{
        isFileOpen=false;
    }
  
    if(isFileOpen){
        $("<div><p>The file is already open. Do you want to reopen it or go to the open file?</p></div>").dialog({
            modal:true,
            title:"File Open",
            buttons:[{
                text:"Reopen",
                click:function(){
                        matchedOpenFiles.each(function(){
                           var file=$(this).attr("file");
                           $(this).remove();
                           $($(this).children("a").attr("href")).remove();
                        });
                        createTabLoadFile()
                        $(this).dialog("close");
                    }
                },{
                    text:"Go to",
                    click:function(){
                        var tabs=$("#openFiles ul li");
                        for(var i=0;i<tabs.length;i++){
                            if($(tabs[i]).attr("file-id")==fileid){
                                $("#openFiles").tabs("option","active",i);
                                break;
                            }
                        }
	                    $("#editor").width($(window).width()-$("#navigation").outerWidth(true)-18);
                        $(this).dialog("close");
                    }
                }
                
            ]
        });
             
    }
    if(isFileOpen){
    }else{
        createTabLoadFile();
    }
}

/**
 * Open, expand, and move to selected Item
 */
function moveToSelectedItem(){
    if($("li div.selected").length>0){
        parentDiv=$("#fileTree");
        innerListItem=$("li div.selected");
        parentDiv.scrollTop(Math.abs(parentDiv.scrollTop() + (innerListItem.position().top - parentDiv.position().top) - (parentDiv.height()/2) + (innerListItem.height()/2)  ));
    }
}

function setupBasicEditor(editor,settings){
    editor.getSession().setOption("wrap",true);
    if(settings.theme!=undefined){
        editor.setTheme(settings.theme);
    }
    if(settings.mode!=undefined){
        editor.getSession().setMode(settings.mode);
    }
	editor.on("change",function(){
       $(settings.link).html("*"+$(settings.link).html().replace("*","")); 
       $(settings.link).addClass("italics");
       $(settings.link).attr("status","editted");
       unsavedChanges();
    });
    editor.commands.addCommand({
        name: 'publish',
        bindKey: {win: 'Ctrl-S',  mac: 'Command-S'},
        exec:function(editor){
            publishFile([editor]);
        },
        readOnly: false 
    });
    /*editor.commands.addCommand({
       name:'close',
       bindKey:{win:'Tab-W',mac:'Tab-W'},
       exec:function(editor){
            $("li[aria-selected='true']").each(function(){
                $(this).find("span.ui-icon-close").trigger('click');
            });
       }
    });
    */
    editor.commands.addCommand({
        name: 'bs',
        bindKey: {win: 'Ctrl-Alt-B',  mac: 'Command-Alt-B'},
        exec:function(editor){
            $('<div style="z-index:1010;"><iframe width="560" height="315" src="https://www.youtube.com/embed/6ykV3zaB0Uo?autoplay=1&start=356&end=365" frameborder="0" allowfullscreen></iframe></div>').dialog({
                width:589,
                zIndex:100,
                modal:true,
                close:function(){
                    $(this).remove();
                }
            }).parent('.ui-dialog').css('zIndex',9999);
        },
        readOnly: true 
    });
}
