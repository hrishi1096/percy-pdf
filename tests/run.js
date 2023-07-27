const yaml = require('js-yaml')
const utils = require('../helpers/utils')
const PORT = 8080
const HOST = 'localhost'
const pdfjsLib = require('pdfjs-dist')
const path = require('path')

let defPdfConfigFilePath = '../configs/pdf-run-info.yml'
const acceptableRunModes = {
  configureBaseline: 'create-baseline',
  compareReleaseWithBaseline: 'compare-release-with-baseline'
}
const pdfjsServerProjectsDir = path.join(__dirname, '/../pdfjs-3.4.120-dist/web/projects')
const userProjectsSourceDir = path.join(__dirname, '/../projects')
const fileEncoding = 'utf8'

const pdfServerBaseUrl = `http://${HOST}:${PORT}`
const pdfViewerUrlPath = '/web/viewer.html?file=/web/projects'

const percyAutoGenConfigFolder = path.join(__dirname, '/../.dist')
const percyAutoGenConfigFileNamePrefix = 'snapshots_'
const percyAutoGenConfigFileExt = '.yml'
const percyDefaultBranchPrefix = 'DOC'

const percyWaitForSelectorCss = 'div#viewer > div.page[data-loaded]'
const percyStaticExecuteScriptBeforeSnapshot =
  "document.querySelector('div#viewer').children.item(0).remove();\ndocument.querySelector('div#viewer').children.length == 1\n  ? document.querySelector('button#next').click()\n  : document\n      .querySelector('div#viewer')\n      .children.item(1)\n      .scrollIntoView();\ndocument\n  .querySelector('div#viewer')\n  .children.item(0)\n  .scrollIntoView();\n"
const percyExecuteScriptReferenceObj = '*restore-page-state'

async function setup () {
  // recreate any existing auto generated folders
  await utils.recreateFolder(pdfjsServerProjectsDir, true)
  await utils.recreateFolder(percyAutoGenConfigFolder, true)

  // copy projects directory from user's project folder to PDFJS local server folder
  await utils.copyFolder(userProjectsSourceDir, pdfjsServerProjectsDir, true)
}

async function readPdfDocsRunInfoConfigs () {
  const args = process.argv.slice(2)
  // Read PDF Docs Run Info Config File supplied by the user.
  // If not found, throw an error and stop the run.
  if (args.length > 0) {
    defPdfConfigFilePath = args[0]
  } else {
    console.error(
      'Please provide the PDF Docs Run Info Configs File path, as a Node Process argument. e.g. npm test config/pdf-docs-run-info-baseline.yml'
    )
    process.exit(1)
  }

  return yaml.load(await utils.readFile(defPdfConfigFilePath, fileEncoding))
}

async function triggerPercyProcess (
  percyConfigFilePath,
  percyBranch,
  percyTargetBranch
) {
  // Trigger Percy built-in automation to process the relevant autogenerated Snapshot Files.
  await utils.startExternalProcess(
    'npx',
    [`percy snapshot "${percyConfigFilePath}"`],
    {
      shell: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        PERCY_BRANCH: `${percyBranch.replace(/\s/g, '')}`,
        PERCY_TARGET_BRANCH: `${percyTargetBranch.replace(/\s/g, '')}`
      }
    }
  )
}

function createPdfDocsRunInfoMap (
  rootConfig,
  allIncludedFilesMap,
  fileName,
  projectFolderName,
  pdfPageCount
) {
  // Create Mapping of Incoming YML file with few additional attributes

  const pdfDocsRunInfoMap = {
    runMode: rootConfig.runMode,
    baselineDir: rootConfig.baselineDir,
    releaseDir: rootConfig.releaseDir,
    pdfDocId: '',
    projectFolder: projectFolderName,
    pdfFileName: fileName,
    pdfPageCount,
    includePages:
      allIncludedFilesMap.get(fileName) === undefined
        ? []
        : allIncludedFilesMap.get(fileName).includePages,
    excludePages:
      allIncludedFilesMap.get(fileName) === undefined
        ? []
        : allIncludedFilesMap.get(fileName).excludePages,
    percyBranch: '',
    percyTargetBranch: '',
    finalWorkingDir: ''
  }

  // Set appropriate environment variables and working folder as per PDF Docs Run Info User config file.

  if (pdfDocsRunInfoMap.runMode === acceptableRunModes.configureBaseline) {
    pdfDocsRunInfoMap.finalWorkingDir = pdfDocsRunInfoMap.baselineDir
    pdfDocsRunInfoMap.pdfDocId = `${percyDefaultBranchPrefix}_${projectFolderName}_${pdfDocsRunInfoMap.finalWorkingDir}_${fileName}`
    pdfDocsRunInfoMap.percyBranch = `${pdfDocsRunInfoMap.pdfDocId}`
    pdfDocsRunInfoMap.percyTargetBranch = ''
  } else if (
    pdfDocsRunInfoMap.runMode === acceptableRunModes.compareReleaseWithBaseline
  ) {
    pdfDocsRunInfoMap.finalWorkingDir = pdfDocsRunInfoMap.releaseDir
    pdfDocsRunInfoMap.pdfDocId = `${percyDefaultBranchPrefix}_${projectFolderName}_${pdfDocsRunInfoMap.finalWorkingDir}_${fileName}`
    pdfDocsRunInfoMap.percyBranch = `${pdfDocsRunInfoMap.pdfDocId}`
    pdfDocsRunInfoMap.percyTargetBranch = `${percyDefaultBranchPrefix}_${projectFolderName}_${pdfDocsRunInfoMap.baselineDir}_${fileName}`
  } else {
    console.error(
      `'runMode' found: ${pdfDocsRunInfoMap.runMode}.\nIt should be either '${acceptableRunModes.configureBaseline}' OR '${acceptableRunModes.compareReleaseWithBaseline}'.\nPlease update ${defPdfConfigFilePath}.`
    )
    process.exit(1)
  }

  return pdfDocsRunInfoMap
}

function createPercySnapshotConfig (pdfDocsRunInfoMap) {
  const additionalSnapshotsForEachPage = []

  let snapshotPagesArr = Array.from(
    { length: pdfDocsRunInfoMap.pdfPageCount - 1 },
    (_, index) => index + 2
  )

  snapshotPagesArr = pdfDocsRunInfoMap.includePages.length === 0 ? snapshotPagesArr : (snapshotPagesArr.filter((value) => pdfDocsRunInfoMap.includePages.includes(value)))

  snapshotPagesArr = pdfDocsRunInfoMap.excludePages.length === 0 ? snapshotPagesArr : (snapshotPagesArr.filter((value) => !pdfDocsRunInfoMap.excludePages.includes(value)))

  console.info(
    `Pages considered for snapshot in DOC: ${pdfDocsRunInfoMap.pdfDocId.replace(
      /\s/g,
      ''
    )} => [1,${snapshotPagesArr}]`
  )

  snapshotPagesArr.forEach((item, index) => {
    const nextIndex = item
    let currentIndex = 1
    let percyDynExecuteScriptBeforeSnapshot =
      "let nextIndex = $$dynamicNextIndex$$;\nfor(currentIndex = $$dynamicCurrentIndex$$;currentIndex < nextIndex; currentIndex++)\n{\ndocument.querySelector('div#viewer').children.item(0).remove();\n}\ndocument.querySelector('div#viewer').children.length == 1\n  ? document.querySelector('button#next').click()\n  : document\n      .querySelector('div#viewer')\n      .children.item(1)\n      .scrollIntoView();\ndocument\n  .querySelector('div#viewer')\n  .children.item(0)\n  .scrollIntoView();\n"
    currentIndex = snapshotPagesArr[index - 1] === undefined ? currentIndex : (currentIndex = snapshotPagesArr[index - 1])
    percyDynExecuteScriptBeforeSnapshot = percyDynExecuteScriptBeforeSnapshot
      .replace('$$dynamicNextIndex$$', nextIndex)
      .replace('$$dynamicCurrentIndex$$', currentIndex)

    if (
      pdfDocsRunInfoMap.includePages.length === 0 &&
      pdfDocsRunInfoMap.excludePages.length === 0
    ) {
      additionalSnapshotsForEachPage.push({
        suffix: ` | Page ${item}`,
        waitForSelector: percyWaitForSelectorCss,
        execute: percyExecuteScriptReferenceObj
      })
    } else {
      additionalSnapshotsForEachPage.push({
        suffix: ` | Page ${item}`,
        waitForSelector: percyWaitForSelectorCss,
        execute: percyDynExecuteScriptBeforeSnapshot
      })
    }
  })

  const snapshotConfigObj = {
    'base-url': pdfServerBaseUrl,
    references: {
      'restore-page-state': `${percyStaticExecuteScriptBeforeSnapshot}`
    },
    snapshots: [
      {
        name: pdfDocsRunInfoMap.pdfFileName,
        url: `${pdfViewerUrlPath}/${pdfDocsRunInfoMap.projectFolder}/${pdfDocsRunInfoMap.finalWorkingDir}/${pdfDocsRunInfoMap.pdfFileName}`,
        waitForSelector: percyWaitForSelectorCss,
        additionalSnapshots: additionalSnapshotsForEachPage
      }
    ]
  }

  return snapshotConfigObj
}

async function furtherCleanseYmlFile (ymlContent) {
  ymlContent = await utils.replaceContentInFile(
    ymlContent,
    'restore-page-state: |',
    'restore-page-state: &restore-page-state | '
  )

  ymlContent = await utils.replaceContentInFile(
    ymlContent,
    /execute: '\*restore-page-state'/g,
    'execute: *restore-page-state'
  )

  return ymlContent
}

function processPdfDocsRunInfoConfigs (rootConfig) {
  try {
    if (rootConfig.projectFolders != null) {
      rootConfig.projectFolders.forEach((projectFolderName) => {
        console.info('Project folder found: ' + projectFolderName)
        const projectReleaseFolderPath = `./projects/${projectFolderName}/${rootConfig.baselineDir}`
        let allIncludedFiles = utils.getFileNames(
          projectReleaseFolderPath,
          '.pdf'
        )

        if (rootConfig.includeDocs != null) {
          allIncludedFiles = allIncludedFiles.filter(function (el) {
            const currProjectDocs = rootConfig.includeDocs.filter(function (
              docs
            ) {
              return docs.project === projectFolderName
            })

            return currProjectDocs.map((obj) => obj.doc).includes(el)
          })
        }

        if (rootConfig.excludeDocs != null) {
          allIncludedFiles = allIncludedFiles.filter(function (el) {
            const currProjectDocs = rootConfig.excludeDocs.filter(function (
              docs
            ) {
              return docs.project === projectFolderName
            })
            return !currProjectDocs.map((obj) => obj.doc).includes(el)
          })
        }

        const allIncludedFilesMap = new Map()

        if (rootConfig.specialDocConfigs != null) {
          rootConfig.specialDocConfigs.forEach((specialConfig) => {
            if (allIncludedFiles.includes(specialConfig.doc) && projectFolderName === specialConfig.project) {
              allIncludedFilesMap.set(specialConfig.doc, {
                includePages: specialConfig.includePages,
                excludePages: specialConfig.excludePages
              })
            }
          })
        }

        allIncludedFiles.forEach(async (fileName) => {
          const pdfPageCount = await pdfjsLib
            .getDocument(`${projectReleaseFolderPath}/${fileName}`)
            .promise.then(function (doc) {
              return doc.numPages
            })

          const pdfDocsRunInfoMap = createPdfDocsRunInfoMap(
            rootConfig,
            allIncludedFilesMap,
            fileName,
            projectFolderName,
            pdfPageCount
          )
          const snapshotConfigObj = createPercySnapshotConfig(
            pdfDocsRunInfoMap
          )

          let ymlSnapshotConfigStr = yaml.dump(snapshotConfigObj)

          ymlSnapshotConfigStr = await furtherCleanseYmlFile(
            ymlSnapshotConfigStr
          )

          const percyConfigFilePath = await utils.writeContentToFile(
            ymlSnapshotConfigStr,
            percyAutoGenConfigFolder,
            percyAutoGenConfigFileNamePrefix +
              pdfDocsRunInfoMap.pdfDocId.replace(/\s/g, '') +
              '_' +
              pdfDocsRunInfoMap.finalWorkingDir +
              percyAutoGenConfigFileExt,
            fileEncoding
          )

          await triggerPercyProcess(
            percyConfigFilePath,
            pdfDocsRunInfoMap.percyBranch,
            pdfDocsRunInfoMap.percyTargetBranch
          )
        })
      })
    }
  } catch (e) {
    console.error(e)
  }
}

(async () => {
  try {
    await setup()
    const pdfDocsRunInfoConfigObj = await readPdfDocsRunInfoConfigs()
    processPdfDocsRunInfoConfigs(pdfDocsRunInfoConfigObj)
  } catch (e) {
    console.error('Encountered Fatal Error: ' + e)
    throw e
  }
})()
