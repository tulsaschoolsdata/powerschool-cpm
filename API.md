# PowerSchool Custom Page Management API

The Custom Page Management tool in PowerSchool uses these undocumented endpoints to query and manipulate custom pages. We can leverage these to automate and streamline some tasks.

[Home](https://powerschool.tulsaschools.org/admin/home.html) > [System](https://powerschool.tulsaschools.org/admin/tech/) > [Page and Data Management](https://powerschool.tulsaschools.org/admin/tech/pageanddatamanagement.html) > [Custom Page Management](https://powerschool.tulsaschools.org/admin/customization/home.html)

---

- [Get File](#get-file)
- [Get Folder](#get-folder)
- [Create File](#create-file)
- [Create Folder](#create-folder)
- [Edit File](#edit-file)
  - [Draft](#draft)
  - [Publish](#publish)
- [Delete File](#delete-file)
- [Delete Folder](#delete-folder)
- [Errors](#errors)

---

## Get File

Retrieve the contents of a custom page.

*Including built-in pages that have not been customized.*

|||
|---|---|
|**URI**|/ws/cpm/builtintext|
|**Method**|GET|
|***Parameters***|
|**LoadFolderInfo**|false|
|**path**|//wildcards/tps_test.txt|

```http
GET /ws/cpm/builtintext?LoadFolderInfo=false&path=//wildcards/tps_test.txt HTTP/1.1
```

```json
// 200 OK
// Content-Type: application/json
{
  "activeCustomContentId":156652,
  "activeCustomText":"test",
  "draftCustomContentId":156654,
  "draftCustomText":"test2",
  "builtInText":"Built in file //wildcards/tps_test.txt is not available.",
  "isCustom":true,
  "hasDraft":false,
  "loadFolderInfo":false,
  "messageKeyMap":{},
  "path":"//wildcards/tps_test.txt",
  "returnMessage":null,
  "selectedVersionTextContent":null,
  "versionAssetContentIds":[156652,156654],
  "versionStatuses":["Active","Draft"],
  "versionTimestamps":["07/02/2021, 10:50:03AM","07/02/2021, 10:58:40AM"]
}
```

**Notes**

- `builtInText` contains the original built-in content provided by PowerSchool. If PowerSchool does not provide the file, the contents will be: `Built in file <PATH> is not available.`
- `isCustom` is `true` if the file is customized or a custom file not provided by PowerSchool.

## Get Folder

A tree of folders and files can be retrieved.

|||
|---|---|
|**URI**|/ws/cpm/tree|
|**Method**|GET|
|***Parameters***|
|**maxDepth**|1|
|**path**|/|


```http
GET /ws/cpm/tree?maxDepth=1&path=/ HTTP/1.1
```

```json
// 200 OK
// Content-Type: application/json
{
  "folder": {
    "pathToParent": null,
    "id": 1,
    "custom": false,
    "children": true,
    "text": "web_root",
    "subFolders": [
      {
        "pathToParent": null,
        "id": null,
        "custom": false,
        "children": true,
        "text": "webutil",
        "subFolders": [],
        "pages": [
          {
            "id": null,
            "text": "jsdebug.html",
            "custom": false,
            "active": true,
            "binary": false
          }
        ]
      }
    ],
    "pages": [
      {
        "id": null,
        "text": "android-chrome-192x192.png",
        "custom": false,
        "active": true,
        "binary": true
      },
    ]
  },
  "path": "/",
  "maxDepth": 1,
  "restrictedAccess": false
}
```

## Create File

Create a new custom file. Existing built-in files should be ”[edited](#edit-file)” to customize them.

|||
|---|---|
|**URI**|/ws/cpm/createAsset|
|**Method**|POST|
|***Parameters***|
|**newAssetName**|tps_test.txt|
|**newAssetPath**|//wildcards|
|**newAssetType**|file|
|**newAssetRoot**||

```http
POST /ws/cpm/createAsset HTTP/1.1
Content-Type: application/x-www-form-urlencoded

newAssetName=tps_test.txt&newAssetPath=%2F%2Fwildcards&newAssetType=file&newAssetRoot=
```

```json
// 200 OK
// Content-Type: application/json
{
  "returnMessage": "File was created successfully"
}
```

## Create Folder

|||
|---|---|
|**URI**|/ws/cpm/createAsset|
|**Method**|POST|
|***Parameters***|
|**newAssetName**|tps_test|
|**newAssetPath**|//wildcards|
|**newAssetType**|folder|
|**newAssetRoot**||

```http
POST /ws/cpm/createAsset HTTP/1.1
Content-Type: application/x-www-form-urlencoded

newAssetName=tps_test&newAssetPath=%2F%2Fwildcards&newAssetType=folder&newAssetRoot=
```

```json
// 200 OK
// Content-Type: application/json
{"returnMessage":"Folder created successfully"}
```

## Edit File

Custom and built-in files can be edited as either [draft](#draft) or [published](#publish).

### Draft

|||
|---|---|
|**Endpoint**|/ws/cpm/customPageContent|
|**Method**|POST|
|**Content-Type**|multipart/form-data|
|***Parameters***|
|**customContentId**|156652|
|**customContent**|test|
|**customContentPath**|//wildcards/tps_test.txt|
|**keyPath**|wildcards.tps_test|
|**keyValueMap**|null|
|**publish**|false|

```http
POST /ws/cpm/customPageContent HTTP/1.1
Content-Type: multipart/form-data

-----------------------------36779504543503939658841564483
Content-Disposition: form-data; name="customContentId"

156652
-----------------------------36779504543503939658841564483
Content-Disposition: form-data; name="customContent"

test
-----------------------------36779504543503939658841564483
Content-Disposition: form-data; name="customContentPath"

//wildcards/tps_test.txt
-----------------------------36779504543503939658841564483
Content-Disposition: form-data; name="keyPath"

wildcards.tps_test
-----------------------------36779504543503939658841564483
Content-Disposition: form-data; name="keyValueMap"

null
-----------------------------36779504543503939658841564483
Content-Disposition: form-data; name="publish"

false
-----------------------------36779504543503939658841564483--
```

```json
// 200 OK
// Content-Type: application/json
{"returnMessage":"The file was saved successfully","activeCustomContentId":0}
```

### Publish

*Note: Two POST requests are made. The first should probably be a GET request but this is what the manager does.*

|||
|---|---|
|**Endpoint**|/ws/cpm/customPageHistory?path=//wildcards/tps_test.txt|
|**Method**|POST|
|**Content-Type**|application/x-www-form-urlencoded|

```http
POST /ws/cpm/customPageHistory?path=//wildcards/tps_test.txt HTTP/1.1
Content-Type: application/x-www-form-urlencoded

```

```json
// 200 OK
// Content-Type: application/json
{"loadFolderInfo":true,"messageKeyMap":{},"path":"//wildcards/tps_test.txt","returnMessage":null,"versionAssetContentIds":[156652],"versionStatuses":["Draft"],"versionTimestamps":["07/02/2021, 10:47:12AM"]}
```

|||
|---|---|
|**Endpoint**|/ws/cpm/customPageContent|
|**Method**|POST|
|**Content-Type**|multipart/form-data|
|***Parameters***|
|**customContentId**|156652|
|**customContent**|test|
|**customContentPath**|//wildcards/tps_test.txt|
|**keyPath**|wildcards.tps_test|
|**keyValueMap**|null|
|**publish**|true|

```http
POST /ws/cpm/customPageContent HTTP/1.1
Content-Type: multipart/form-data

-----------------------------249337336813230774702942391262
Content-Disposition: form-data; name="customContentId"

156652
-----------------------------249337336813230774702942391262
Content-Disposition: form-data; name="customContent"

test
-----------------------------249337336813230774702942391262
Content-Disposition: form-data; name="customContentPath"

//wildcards/tps_test.txt
-----------------------------249337336813230774702942391262
Content-Disposition: form-data; name="keyPath"

wildcards.tps_test
-----------------------------249337336813230774702942391262
Content-Disposition: form-data; name="keyValueMap"

null
-----------------------------249337336813230774702942391262
Content-Disposition: form-data; name="publish"

true
-----------------------------249337336813230774702942391262--
```

```json
// 200 OK
// Content-Type: application/json
{"returnMessage":"The file was published successfully","activeCustomContentId":0}
```

## Delete File

Delete a custom file. If the file is built-in, this removes the customization.

|||
|---|---|
|**Endpoint**|/ws/cpm/deleteFile|
|**Method**|POST|
|**Content-Type**|application/x-www-form-urlencoded|
|***Parameters***|
|**path**|//wildcards/tps_test.txt|

```http
POST /ws/cpm/deleteFile HTTP/1.1
Content-Type: application/x-www-form-urlencoded

path=%2F%2Fwildcards%2Ftps_test.txt
```

```json
// 200 OK
// Content-Type: application/json
{"returnMessage":"The file was deleted sucessfully"}
```


## Delete Folder

⚠️ *This operation is VERY SLOW however it does work. (~5 minutes)*

Deletes a folder.

|||
|---|---|
|**Endpoint**|/ws/cpm/deleteFolder|
|**Method**|POST|
|**Content-Type**|application/x-www-form-urlencoded|
|***Parameters***|
|**path**|//wildcards/tps_test.txt|
|**forceDelete**|false|


```http
POST /ws/cpm/deleteFolder HTTP/1.1
Content-Type: application/x-www-form-urlencoded

path=%2F%2Fwildcards%2Ftps_test%2Fsubfolder&forceDelete=false
```

```json
// 200 OK
// Content-Type: application/json
{"returnMessage":"The folder was deleted sucessfully"}
```

If the folder is not empty, a different message is returned. Set `forceDelete=true` to delete non-empty folders.

```json
// 200 OK
// Content-Type: application/json
{"returnMessage":"folder_not_empty"}
```

## Errors

Deleting a folder that does not exist or was already deleted.

```json
// 400 Bad Request
// Content-Type: application/json
{"message":"The folder could not be deleted because of a system error"}
```