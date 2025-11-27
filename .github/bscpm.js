
var snippetsPath="/admin/bscpm/snippets";
var templatesPath="/admin/bscpm/templates";
var urlPublishContent="/ws/cpm/customPageContent";
var urlRetrieveData="/ws/cpm/builtintext";
var urlCreate="/ws/cpm/createAsset";
var urlTree="/ws/cpm/tree";
var urlDelete="/ws/cpm/deleteFile";
var urlCustomizeStockAsset="/ws/cpm/customizeAsset";
var fullscreen=false;
var urlDeleteFolder="/ws/cpm/deleteFolder";
/**
 * Check to see if logged in. Uses synchronious ajax call
 * 
 * @return bool True if Logged in, False otherwise
 * 
*/
function loggedIn(){
    var amIin=false;
    var url=urlTree;
    var parameters=[
        {"name":"maxDepth","value":1},
        {"name":"rnd","value":Math.random()*1E16}
    ];
    var loggedInStatus=200;
    var loggedOutStatus=302;
    var t=false;
    $.ajax(url,{
        async:false,
        data:parameters,
        success:function(data,status,jxhr){
            if(typeof(data)=="object"){
                amIin=true;
            }else{
                amIin=false;
            }
        },
        failure:function(){
            amIin=false;
        }
    });
    return amIin;
}
/**
 * This check to make sure we are still logged in
 * 
 * @param response From Ajax 
 * 
 * @return true if logged in and okay, false otherwise
 */
function checkReturnData(data){
    dataType=typeof(data);
   if(dataType.toLowerCase()=='object'){
       return true;
   } else{ 
       return false;
   }
}
/**
 * Create the keyPath variable for saving files
 * 
 * @param string path to file (minus filename)
 * @param string name of file
 * 
 * @return string The keyPath variable basically a form of the full Path
 */
function keyPath(path,file){
    if(file===undefined){
        var fileparts=path.split("/");
        file=path[path.length-1];
    }
    var fileparts=file.split(".");
	fileparts.pop();
	file=fileparts.join(".");
    return path.replace(/\//g,".").substr(1)+"."+file;
}

/**
 * Get all editors or active editor
 * 
 * @param bool (optional) true to return only currently Active Editor, (default) false/blank to return all editors
 * 
 * @return Array an array of editors or an empty array
 */
function getEditors(active){
    var editorArray=[];
    if(active===true){
        if($("li[aria-selected=true]").length>0){
            var selectedTabName=$($("li[aria-selected=true]").children("a")[0]).attr("href").replace("#","");
            if($("#"+selectedTabName+"-editor").attr("editor")=="true"){
                editorArray.push(ace.edit(selectedTabName+"-editor"));
            }
        }
    }else{
        $('div[id$="-editor"]').each(function(){
            if($("#"+$(this).attr("id")).attr("editor")=="true"){
                editorArray.push(ace.edit($(this).attr("id")));
            }
        });
    }
    return editorArray;
}
/**
 * Publish/save an array of editors
 * 
 * @param array of Editors (default) Get active editor
 * @param bool true to close tab when done, (default) false/blank to leave tab open
 */
function publishFile(editors,closeTab){
    if(editors===undefined){
        editors=getEditors(true);
    }
    if(closeTab===undefined){
        closeTab=false;
    }
    for(var i=0;i<editors.length;i++){
        let selectTab=$(editors[i].container).attr('id').replace("-editor","");
        let selectedTabSelector="li[aria-controls="+selectTab+"]";
        let contents=editors[i].getValue();
        let customContentId=$(selectedTabSelector).attr("customcontentid");
        let a=$(selectedTabSelector).children("a")[0];
        let url=urlCustomizeStockAsset;
        let path=$(selectedTabSelector).attr("path")=="/"?"":$(selectedTabSelector).attr("path");
        let file=$(selectedTabSelector).attr("file");
        let fileType="file";
        let fullPath=path=="/"?"/"+file:path+"/"+file;
        let kPath=keyPath($(selectedTabSelector).attr("path"),$(selectedTabSelector).attr("file"));
        if(customContentId!="-1"){
           //already Customized
           return publishRequest(a,contents,kPath,customContentId,"/"+fullPath,closeTab);
        }else{
            
            var parameter=[
                {"name":"newAssetPath","value":"/"+path},
                {"name":"newAssetName","value":file},
                {"name":"newAssetType","value":"file"},
                {"name":"initialAssetContent","value":contents}
            ];
            return $.ajax(url+"?_="+Math.random()*1E16,{
                data:parameter,
                method:"POST",
                dataType:"json",
                success:function(data){
                    if(data.returnMessage=="Custom file was created successfully"){
                        $(a).html($(a).html().replace("*","")); 
                        $(selectedTabSelector).attr("customcontentid",data.activeCustomContentId);
                        $(a).removeClass("italics");
                        $(a).attr("status","original");
                         $('#fileTree li[item-type="file"][item-path="'+fullPath.replace($(selectedTabSelector).attr("file"),"").substring(0,fullPath.replace($(selectedTabSelector).attr("file"),"").length-1)+'"][item-name="'+$(selectedTabSelector).attr("file")+'"]').attr("item-custom",true);
                        publishRequest(a,contents,kPath,data.activeCustomContentId,"/"+fullPath,closeTab);
                    }else{
                        toastr.error("There was an issue saving. 1b\n"+data.returnMessage);
                    }
                    $(selectedTabSelector).attr("customcontentid",data.activeCustomContentId);
                },
                failure:function(data){
                    toastr.error("There was an issue saving. 1a");
                }
            });
        }
    }
};
/**
 * Processes the request to the server. Has toastr popup for success and failure
 * 
 * @param jquery Object/tab anchor id The anchor referring to tab name
 * @param jquery Object/tab li the tab relatated to the file to publish
 * @param string Contents of the file
 * @param string KeyPath returned from the keyPath function
 * @param string the customcontentId for CPM to save the file
 * @param string Full path to the file (includes file name) * 
 * @param bool true to close tab when done, (default) false/blank to leave tab open
 * 
 */
function publishRequest(a,contents,kPath,customContentId,fullPath,closeTab){
    let data=new FormData();
    data.append("customContentId",customContentId);
    data.append("customContent",contents);
    data.append("customContentPath",fullPath);
    data.append("keyPath",kPath);
    data.append("keyValueMap","{}");
    data.append("publish","true")
    
    file=fullPathDisection(fullPath);
    return $.ajax(urlPublishContent+"?_="+Math.random()*1E16,{
        data:data,
        headers:{
            "Accept":"application/json, text/plain, */*"
        },
        contentType:"multipart/form-data",
        processData: false,
        method:"POST",
        success:function(data,status,jxhr){
            if(data.returnMessage=="The file was published successfully"){
                var label=$(a).html();
                $(a).html(label.replace("*","")); 
                $(a).removeClass("italics");
                $(a).attr("status","original");
                toastr.success(file.filename+' Saved');
                unsavedChanges();
                var pathParts=fullPath.split("/");
                file=pathParts[pathParts.length-1];
                pathParts.pop();
                path=pathParts.join("/");
                saveVersion(file,path,contents);
                if(closeTab){
                    closeFile($(a).parent());
                }
            }else{
                toastr.error("There was an issue saving "+file.filename+". 1b\n"+data.returnMessage);
            }
            
        },
        failure:function(data){
            toastr.error("There was an issue saving "+file.filename+". 1b\n");
        },
        statusCode:{
            401:function(){
                var success={
        	        callback:publishRequest,
        	        parameter:[a,contents,kPath,customContentId,fullPath,closeTab]
        	    };
        	    loggin(success);
            }
        }
    });
};
/**
 * This will close the tab and editor with a prompt to save
 *  
 * @param jquery object/tab li for the tab that is being closed
 * @param bool true to skip save prompt, (default) False/blank normal function
 */
function closeFile(tab,noprompt,saveOpenedFiles){
    if(noprompt===undefined){
        noprompt=false;
    }
    if(saveOpenedFiles===undefined){
        saveOpenedFiles=true;
    }
    var close=function(){
        var panelId = $( tab ).remove().attr( "aria-controls" );
        $( "#" + panelId ).remove();
        $("#openFiles").tabs("refresh");
        if($("#openFiles li").length===0){
            $('#unsavedChanges').removeClass('dirty');
        }
        if(saveOpenedFiles){
            savePrefs();
        }
    };
    if(noprompt){
        //shut it down
        close();
    }else{
        if($($(tab).children()[0]).attr('status')=='original'){
            close();
        }else{
            var filename=$(tab).attr("file");
            $("<div>"+filename+" has not been saved.</div>").dialog({
                modal:true,
                autoOpen:true,
                buttons:[
                    {
                        text:"Save",
                        click:function(){
                            var panelId = $( tab ).attr( "aria-controls" );
                            var editors=[ace.edit(panelId+"-editor")];
                            publishFile(editors,true);
                            close();
                            $(this).dialog("close");
                                
                        }
                    },
                    {
                        text:"Don't Save",
                        click:function(){
                            close();
                            $(this).dialog("close");
                        }
                    },
                    {
                        text:"Cancel",
                        click:function(){
                            $(this).dialog("close");
                        }
                    }]
            })
        }
    }
}

/**
 * Create file or folder. Has toastr popup for success and failure
 * 
 * @param string File/folder name
 * @param string Path to parent folder
 * @param string folder or file
 * @param jquery object/div#new
 * 
 */
function createItem(fileName,path,type,dialog,skip){
    if(skip===undefined){
        skip=false;
    }
    var parameter=[
        {"name":"newAssetName","value":fileName},
        {"name":"newAssetPath","value":path},
        {"name":"newAssetType","value":type}
    ];
    return $.ajax(urlCreate,{
        method:"POST",
        data:parameter,
        success:function(data){
            if(!(checkReturnData(data))){
                var success={
        	        callback:createItem,
        	        parameter:[fileName,path,type,dialog,true]
                };
        	    loggin(success);
            }else{
                switch(data.returnMessage){
                    case "This file already exists":
                        if(skip){
                            status=true;   
                        }else{
                            var status=false;
                            $("#newError").html("This file already exists.").addClass("ui-state-error");
                        }
                        break;
                    case "File was created successfully":
                        status=true;
                        
                        if(path.substr(0,snippetsPath.length)==snippetsPath || path.substr(0,templatesPath.length)==templatesPath ){
                            if(path.substr(0,snippetsPath.length)==snippetsPath ){
                                loadDropdown("snippets");
                            }
                            if(path.substr(0,templatesPath.length)==templatesPath ){
                                loadDropdown("templates");
                            }
                        }
                        //File created
                        break;
                    case "Folder created successfully":
                        status=true;
                        //File created
                        break;
                    case "This folder already exists":
                        if(skip){
                            status=true
                        }else{
                            status=false;
                            $("#newError").html("The folder already exists").addClass("ui-state-error");
                        }
                    default:
                }
                if(status){
                    if(path===""){
                        directory=$("#fileTree");
                    }else{
                        pathparts=path.split("/");
                        lastfolder=pathparts[pathparts.length-1];
                        lastFolderParent=path.replace("/"+lastfolder,"").replace("/","\\/");
                        directory=$("li[item-type=directory][item-path='"+lastFolderParent+"'][item-name="+lastfolder+"]");
                    }
                    refreshDirectory(directory);
                    toastr.success(fileName+' Created');
            	    if(data.returnMessage=="File was created successfully"){
            	        loadFile(path,fileName,true);
                    }
                    $(dialog).dialog("close");
                }
            }
        },
        failure:function(data){
            //TODO: request failure
            alert('Creation failed');
        }
    });
}
/**
 * Delete file and remove from file tree
 * 
 * @param string full path to file (includes file name)
 * @param jquery object to be removed
 */
function deleteFile(fullPath,selectedItem){
    var parameter=[
        {"name":"path","value":"/"+fullPath}
    ];
    return $.ajax(urlDelete+"?_="+Math.random()*1E16,{
        data:parameter,
        method:"POST",
        success:function(data){
            if(!(checkReturnData(data))){
                var success={
        	        callback:deleteFile,
        	        parameter:[fullPath,selectedItem]
        	    };
        	    loggin(success);
            }else{
                switch(data.returnMessage){
                    case "The file could not be deleted because of a system error":
                        var status=false;
                        toastr.error(fullPath+' Not Deleted');
                        //problem
                        break;
                    case "The file was deleted sucessfully":
                        file=fullPath.replace(/(\/|\.)/g,"");
                        closeFile( $("li[file-id='"+file+"']")[0],true);
                        //File deleted
                        selectedItem.remove();
                        toastr.success(fullPath+' Deleted');
                        if(fullPath.substr(0,snippetsPath.length)==snippetsPath || fullPath.substr(0,templatesPath.length)==templatesPath ){
                            if(fullPath.substr(0,snippetsPath.length)==snippetsPath ){
                                loadDropdown("snippets");
                            }
                            if(fullPath.substr(0,templatesPath.length)==templatesPath ){
                                loadDropdown("templates");
                            }
                        }
                        break;
                    default:
                        alert("Uhh Ohh");
                }
            }
        },
        failure:function(data){
            //request failure
            alert("Alert! Request Down!");
        }
    });
}
/**
 * Open or close file drawer
 * 
 * @param string (optional) open/close drawer
 */
function slide(action){
    var navigation = $("#navigation");
    if(action===undefined){
        if(parseInt($(navigation).css("left"))<0){
            action="open";
        }else{
            action="close";
        }
    }
    switch(action){
        case "open":
            $(navigation).animate(
                {left: "0"},
                {
                    done:function(){
                            $(window).resize();
                       }
                }
            );  
            break;
        case "close":
            $(navigation).delay(100).animate(
                {left: "-"+(navigation.width()+2)+"px"},
                {
                    done:function(){
                        $(window).resize();
                    }
                }
            );
            break;
    }
}
/**
 * Create snippet or template dropdown, used to create and update
 * 
 * @param string snippets/templates
 */
function loadDropdown(type){
    
	var sort=function(a,b){
	   if(a.text.toLowerCase()==b.text.toLowerCase()){
	       return 0;
	   }
	  if(a.text.toLowerCase()>b.text.toLowerCase()){
	      return 1;
	  }else{
	      return -1;
	  }  
	};
	switch(type){
	    case "snippets":
	        fullpath=snippetsPath;
            errorMessage="Failed to refresh snippets";
            ulElement=$("#snippets-dropdown ul");
            break;
        case "templates":
            fullpath=templatesPath;
            errorMessage="Failed to refresh templates";
            ulElement=$("#templates-dropdown ul");
            break;
	}
	ulElement.empty();
    var parameters=[
	    {"name":"maxDepth","value":"999"},
	    {"name":"rnd","value":Math.random()*1E16},
	    {"name":"path","value":fullpath}
	];
    (function(parameters,ulElement,errorMessage){
        $.ajax(urlTree,{
            data:parameters,
            dataType:"json",
            success:function(data,status,jxhr){
                var pages=data.folder.pages;
                pages.sort(sort);
                for(var i=0;i<pages.length;i++){
                    var a=$("<a />").attr("href","#");
                    var li=$("<li />").html(pages[i].text.substr(0,pages[i].text.lastIndexOf("."))).attr("item-fullpath",data.path+"/"+pages[i].text);
                    a.append(li);
                    ulElement.append(li);
                }
            },
            failure:function(data){
                $.toastr("error",errorMessage);
            }
        });
    })(parameters,ulElement,errorMessage);
}
/**
 * Collapse code for the current editor
 */
function collapse(){
    var editor=getEditors(true);
    if(editor.length>0){
        editor[0].getSession().foldAll(0,editor[0].getSession().getLength(),1);
    }
}
/**
 * Expand code step by step for the current editor
 */
function expand(){
    var editor=getEditors(true);
    if(editor.length>0){
       editor[0].getSession().expandFolds(editor[0].getSession().getAllFolds());
    }
}
/**
 * Go to a file immediately after logging or loading CPM
 */ 
function initialFile(){
    var listFiles=$("#goToFile").val();
    if(listFiles===""){
        return;
    }
    files=listFiles.split(",");
    for(var i=0;i<files.length;i++){
        var pathParts=files[i].split("/");
        var path=files[i].replace("/"+pathParts[pathParts.length-1],"");
        var file=pathParts[pathParts.length-1];
        loadFile(path,file,$("li[item-path='"+path+"'][item-name='"+file+"']").attr("item-custom"),"normal",-1,true);
        if(i==files.length-1){
            $("li[item-path='"+path+"'][item-name='"+file+"'] div").addClass('selected');
            goToSelectedDirectory();
            moveToSelectedItem();
        }
        $("#goToFile").val("");
    }
}
/**
 * Check to make sure file name is valid
 * 
 * @return true is okay, false id valid
 */
function checkFilename() {
    var regexp=/^[a-zA-Z0-9._,\-]+\.(txt|html|htm|js|javascript|json|css|rpt|xml|text|csv|tsv|ftl)$/;
    var o=$("#newAssetName");
    switch($("#newAssetType").val()){
        case "file":
            if(!(regexp.test(o.val()))) {
                o.addClass( "ui-state-error" );
                return false;
            }else{
                return true;
            }
            break;
        case "folder":
            if(o.val().trim().length===0) {
                o.addClass( "ui-state-error" );
                return false;
            }else{
                return true;
            }
    }
}
/**
 * Activated/Deactivate fullscreen mode
 */
function fullscreenToggle(){
    fullscreen=!fullscreen;
    if(fullscreen){
        //turn on fulll screen
        $("#navigation").addClass("fullscreen");
        slide("close");
        $("#folderTab").removeClass("hide");
        $("#navigation").hover(function(){
            $("#navigation").stop(true,false);
            slide("open");
        },function(e){
            slide();
        });
    }else{
        $("#navigation").removeClass("fullscreen");
        slide("open");
        $("#navigation").off('hover');
        $("#folderTab").addClass("hide");
    }
}
/**
 * Retrieve a json containing file, path, full path, and ext
 * 
 * @param editor
 * 
 * @return json contains properties file,path,fullPath, and ext
 */
function getFileInfoFromEditor(editor){
    var selectTab=$(editor.container).attr('id').replace("-editor","");
    var file=$($("a[href='"+"#"+selectTab+"']").parent()).attr("file");
    var path=$($("a[href='"+"#"+selectTab+"']").parent()).attr("path");
    var fullPath=path=="/"?"/"+file:path+"/"+file;
    fileParts=file.split(".");
    if(fileParts>=2){
        var ext=fileParts[fileParts.length-1];
    }else{
        ext=null;
    }
    return{
        "file":file,
        "path":path,
        "fullPath":fullPath,
        "ext":ext
    };
}
/**
 * Change theme for all editors and save cookie
 * 
 * @param string string for the theem
 */
function changeEditorTheme(theme){
    editors=getEditors();
    $("div[id$='-editor-compare']").each(function(){
        editors.push(ace.edit($(this).attr("id")));
        console.log($(this).attr("id"));
    });
    for(var i=0;i<editors.length;i++){
        editors[i].setTheme(theme);
    }
}
function loggin(success,failure,modal){
    if(modal===undefined){
        modal=false;
    }
    if(success===undefined || success===null){
        var successFunction=null;
        var successParameters=null;
    }else{
        switch(typeof(success)){
            case "function":
                successFunction=success;
                successParameter=null;
                break;
            case "object":
                successFunction=success.callback;
                switch(typeof(success.parameter)){
                    case "undefined":
                        successParameter=null;
                        break;
                    case "object":
                    case "array":
                        successParameter=success.parameter;
                        break;
                    default:
                        successParameter=null;
                }
                break;
            default:
        }
    }
    $("#loginDia").dialog("option","buttons",null);
    $("#loginDia").dialog("option","buttons",[ 
        {
            id:"loginBtn",
            text:"Log In",
            "modal":modal,
            click:function(){
                if($("#username").val()=="" || $("#password").val()==""){
                    $("#loginError").html("Please fill in both fields").addClass("ui-state-error");
                    return;
                }
                $("span.ui-button-text:contains('Log In')").html($("<img src=\"images/ajax-loader.gif\" />"));
                
                $.ajax("/admin/pw.html",{
                    success:function(data){
                        let psKey=data.match(/var pskey = "[a-zA-Z0-9]*"/)[0].match(/"[a-zA-Z0-9]*"/)[0].replace(/"/g,"")
                        let psToken=$j((data.match(/<input type="hidden" name="pstoken" value="[a-zA-Z0-9]*">/)[0])).val()
                        let loginData={
                            ldappassword:$("#password").val(),
                            pstoken: psToken,
                            username: $("#username").val(),
                            password: hex_hmac_md5(psKey, b64_md5($("#password").val()))
                        };
                        $.ajax("/admin/home.html",{
                            method:"POST",
                            data:loginData,
                            success:function(data,status,jxhr){ 
                                if(data.search("PS Server Uptime")>-1){
                                    $("#loginError").html("Log in failed. Please try again").addClass("ui-state-error");
                                    $("span.ui-button-text").has("img").each(function(){
                                        $(this).html("Log In");
                                    });
                                    
                                }else{
                                    if(successFunction!=null){
                                        successFunction.apply(this,successParameter);
                                    }
                                    $(dialog).dialog("close");
                                }
                            },
                            failure:function(data){
                                $("#loginError").html("There was an issue contacting server.2a");
                            },
                            error:function(data){
                                if(successFunction!=null){
                                    successFunction.apply(this,successParameter);
                                }
                                $("#adminLogoutMessage").html("").removeClass("error");
                                $("#loginDia").dialog("close");
                            },
                            statusCode:{
                                302:function(){
                                    if(successFunction!=null){
                                        successFunction.apply(this,successParameter);
                                    }
                                    $(dialog).dialog("close");
                                }
                            }
                        });    
                    }
                })
            }
        },
        {
            id:"cancelLoginBtn",
            text:"Cancel",
            click:function(){
                $(this).dialog("close");
            }
        }
    ]);
    $("#loginDia").dialog("open");   
}
function saveVersion(filename,path,fileContents){
    /*var parameters=[
        {"name":"CF-[:0.U_versions.U_Versions:-1]filename","value":filename},
        {"name":"CF-[:0.U_versions.U_Versions:-1]path","value":path},
        {"name":"CF-[:0.U_versions.U_Versions:-1]filecontents","value":fileContents},
        {"name":"ac","value":"prim"}
    ];
    $.ajax("/admin/changesrecorded.white_nf.html",{
        method:"POST",
        data:parameters,
        success:function(data){
            
        },
        failure:function(data){
            toastr.failure("Version Not saved.");
        }
    });
    */
}
function loadVersions(filename,path){
    var url="version.html";
    row="<div class=\"versionRow\"><div class=\"versionCell heading\">Date</div><div class=\"versionCell heading\">By Whom</div><div class=\"versionCell heading\">Notes</div></div>";
    row+="<div data-id=\"-1\" class=\"versionRow\"><div class=\"versionCell\">-</div><div class=\"versionCell\"></div><div class=\"versionCell\">Original</div></div>";
    
    var parameters= [
        {"name":"filename","value":filename},
        {"name":"path","value":path}
    ];
    $.ajax(url,{
        method:"POST",
        dataType:"json",
        data:parameters, 
        success:function(data){
            var allowedDates=[];
            data.days.pop();
            for(var i=0;i<data.days.length;i++){
                allowedDates.push([data.days[i].day,data.days[i].versions.length]);
            }
            var available=function(date) {
                for(i=0;i<allowedDates.length;i++){
                    dmy=new Date(allowedDates[i][0])
                    if(dmy.valueOf()==date.valueOf()){
                        var suffix=allowedDates[i][1]>1?"s":"";
                        return[true,"",allowedDates[i][1]+" version"+suffix];
                    }
                }
                return [false,"","No Versions"];
            };
            $("#calendar").datepicker("option","onSelect",function(date,inst){
               for(i=0;i<data.days.length;i++){
                   date=new Date(date);
                   var dmy=new Date(data.days[i].day);
                   if(dmy.valueOf()==date.valueOf()){
                       version=data.days[i].versions;
                       for(var j=0;j<version.length;j++){
                           row+="<div data-id=\""+version[j].id+"\"class=\"versionRow\"><div class=\"versionCell\">"+version[j].created+"</div><div class=\"versionCell\">"+version[j].who+"</div><div class=\"versionCell\">"+version[j].comment+"</div></div>";
                       }
                       break;
                   }
                }
                $("#versionTable").empty();
                $("#versionTable").append($(row));
            });
            $("#calendar").datepicker("option","beforeShowDay",available);
            $j("#versionDiag").dialog("open");
        }
        
    });
}
/*
function copy(originalFile,newFile,callback){
    if(callback===undefined){
        var successFunction=null;
        var successParameters=null;
    }else{
        switch(typeof(success)){
            case "function":
                successFunction=success;
                successParameter=null;
                break;
            case "object":
                successFunction=callback.success;
                switch(typeof(callback.parameter)){
                    case "undefined":
                        successParameter=null;
                        break;
                    case "object":
                    case "array":
                        successParameter=callback.parameter;
                        break;
                    default:
                        successParameter=null;
                }
                break;
            default:
        }
    }
    
    
    var originalFile=fullPathDisection(originalFile);
    var newFile=fullPathDisection(newFile);
    if(newFile.absolute){
        var newFileFullPath=newFile.path+"/"+newFile.filename;
    }else{
        if(newFile.path!=null){
            newFileFullPath=originalFile.path+"/"+newFile.path+"/"+newFile.filename;
        }else{
            newFileFullPath=originalFile.path+"/"+newFile.filename;
        }
    }
    var url="/powerschool-sys-mgmt/custompages/builtintext.action";
    var parameter=[
        {"name":"path","value":originalFile},
        {"name":"LoadFolderInfo","value":false},
        {"name":"rnd","value":Math.random()*1E16}
    ];
    var urlCreate="/powerschool-sys-mgmt/custompages/createAsset.action";
    file=fullPathDisection(newFileFullPath);
    var createparameter=[
        {"name":"newAssetPath","value":file.path},
        {"name":"newAssetName","value":newFile.filename},
        {"name":"newAssetType","value":"file"}
    ];
    var contents="";
    if(!loggedIn()){
	    var success={
	        callback:copy
	    };
	    loggin(success);
	}else{
        //Get the contents of the 
        $.when(
            $.ajax(url,{
                data:parameter,
                success:function(data){
                    if(data.activeCustomText.search("is not available")>-1){
                        contents=data.builtInText;
                    }else{
                        contents=data.activeCustomText;
                    }
                }
            }),
            $.ajax(urlCreate,{
                data:parameter,
                method:"POST",
                dataType:"json",
                success:function(data){
                    if(data.returnMessage=="File created successfully"){
                        parts=fullPathDisection(file.path);
                        refreshDirectory($("li[item-name='"+parts.filename+"'][item-path='"+parts.path+"']"));
                        var kPath=keyPath(file.path,file.filename);
                        var parameter=[
                            {"name":"customContent","value":contents},
                            {"name":"keyPath","value":kPath},
                            {"name":"customContentId","value":data.activeCustomContentId}
                        ];
            })
        ).then(
            function(){
                var url="/powerschool-sys-mgmt/custompages/publishCustomPageContent.action";
                $.ajax(url,{
                    data:parameter,
                    method:"POST",
                    success:function(data,status,jxhr){
                        if(data.returnMessage=="The file was published successfully"){
                            toastr.success($(selectedTabSelector).attr("file")+' Saved');
                            toastr.success('File Copied');
                            if(successFunction!=null){
                                successFunction.apply(this,successParameter);
                            }
                        }else{
                            toastr.error("There was an issue saving "+file.filename+". 1b\n"+data.returnMessage);
                        }
                    },
                    failure:function(data){
                        toastr.error("There was an issue saving "+file.filename+". 1b\n");
                    }
                });
            }
        );
	}
}
*/
function fullPathDisection(fullpath){
    value={
        "absolute":false,
        "path":null,
        "filename":null,
        "extension":null,
    };
    fileParts=fullpath.split("/");
    value.filename=fileParts[fileParts.length-1]
    if(fullpath.substr(0,1)=="/"){
        value.absolute=true;
    }else{
        value.absolute=false
    }
    if(fileParts.length>1){
        value.path=fullpath.replace("/"+value.filename,"");
    }else{
        if(value.absolute){
            value.path="";
        }
    }
    value.extension=value.filename.lastIndexOf(".")!=-1?value.filename.substr(value.filename.lastIndexOf(".")+1):null;
    return value;
}
function bookmark(){
    var openFiles=[];
    $("#openFiles").find("li").each(function(){
        openFiles.push($(this).attr("path")+"/"+$(this).attr("file"));
    });
    return {
        "url":window.location.protocol+"//"+window.location.host+window.location.pathname+"?goToFile="+encodeURIComponent(openFiles.join(",")),
        "files":openFiles
    };
}
function unsavedChanges(){
    if($("#openFiles li a:contains('*')").length>0){
        $('#unsavedChanges').addClass('dirty');
    }else{
        $('#unsavedChanges').removeClass('dirty');
    }
    
}
/**
 * Export file 
 *  @param Array of full file names
 * 
 */
 function exportFiles(files){
     files=files.map(function(d){
         return "WEB_ROOT"+d;
     })
    $("#SelectedFileList").val(files.join("\n"));
    return true;
 }
 
function selectedFiles(useHidden){
     if(useHidden===undefined){
         useHidden=false
    }
    selected=[];
    if($("li[item-type='directory'] div.selected").length>0){
        //File/directory is selected
        //I need to find all the files in selected directories and add selected files
        $("li[item-type='directory'] div.selected").closest("li").find("li[item-type='file']").add($j("li[item-type='file'] div.selected").closest("li")).each(function(){
            if(useHidden && $(this).attr('display-status')==="false"){
            }else{
                selected.push($(this).attr("item-path")+"/"+$(this).attr("item-name"));
            }
        });
    }else{
        //currently showing files
        $("li[item-type='file'][display-status=true]").each(function(){
            if(useHidden && $(this).attr('display-status')==="false"){
                
            }else{
                selected.push($(this).attr("item-path")+"/"+$(this).attr("item-name"));
            }
        });
    }
    return selected;
 }
 /**
  * Add plugin info
  */
 function assignPluginInfo(){
     var url="pluginFiles.json";
     $j.ajax(url,{
         dataType:"json",
         success:function(response){
             plugins=response.plugins;
             plugins.pop();
             files=response.files;
             files.pop();
             for(var i=0;i<files.length;i++){
                 $j("li[item-name='"+files[i].filename+"'][item-path='"+files[i].path+"']").attr('plugin-id',files[i].pluginId);
             }
             $("#plugin").empty();
             $("#plugin").append('<option value="">Filter by Plugin</option>').append('<option value="-1">Not in a plugin</option>').append('<option value="">---------------------------</option>');
             for(i=0;i<plugins.length;i++){
                 $("#plugin").append('<option value="'+plugins[i].id+'">'+plugins[i].name+'</option>')
             }
             $("#fileTree li:not([plugin-id])[item-type='file'").attr("plugin-id",-1);
            $("#adminLogoutMessage").html("").removeClass("error");
             filterFiles();
             
         },
         error:function(data){
            toastr.error("Preferences not saved");
            $("#adminLogoutMessage").html("Admin Logged out. Plugin filter, save state, and export may not work as expected <a href=\"/admin/\" target=\"_blank\">Log In</a>").addClass("error");
         }
     })
 }
 
 function savePrefs(){
     var files=bookmark();
     var prefJson={
         "showCustom":$("#showCustomOnly").is(':checked'),
         "plugin":$("#plugin").val(),
         "theme":$("#theme").val(),
         "openFiles":files.files.join(",")
     };
     $("#bscpmPrefs").val(JSON.stringify(prefJson));
     var url="/admin/changesrecorded.white_nf.html";
     $.ajax(url,{
         method:"post",
         data:$("#prefForm").serialize(),
         success:function(data){
         },
         error:function(data){
            toastr.error("Preferences not saved");
            $("#adminLogoutMessage").html("Admin Logged out. Plugin filter, save state, and export may not work as expected <a href=\"/admin/\" target=\"_blank\">Log In</a>").addClass("error");
         }
     });
     
 }