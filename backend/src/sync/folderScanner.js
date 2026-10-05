const fs = require("fs");
const path = require("path");
const HashService =
    require("../integrity/hashService");


class FolderScanner {

    static async scanFolder(folderPath) {

        if (!folderPath) {

            throw new Error(
                "Folder path is required"
            );
        }


        if (!fs.existsSync(folderPath)) {

            throw new Error(
                "Folder does not exist"
            );
        }


        const stats =
            fs.statSync(folderPath);


        if (!stats.isDirectory()) {

            throw new Error(
                "Provided path is not a folder"
            );
        }


        const files = [];


        await this.scanDirectory(
            folderPath,
            folderPath,
            files
        );


        return files;
    }


    static async scanDirectory(
        rootFolder,
        currentFolder,
        files
    ) {

        const entries =
            fs.readdirSync(
                currentFolder,
                {
                    withFileTypes: true
                }
            );


        for (const entry of entries) {

            const fullPath =
                path.join(
                    currentFolder,
                    entry.name
                );


            if (entry.isDirectory()) {

                await this.scanDirectory(
                    rootFolder,
                    fullPath,
                    files
                );

                continue;
            }


            if (!entry.isFile()) {
                continue;
            }


            const stats =
                fs.statSync(fullPath);


            const relativePath =
                path.relative(
                    rootFolder,
                    fullPath
                );


            const fileHash =
                await HashService.hashFile(
                    fullPath
                );


            files.push({

                relativePath:
                    relativePath,

                size:
                    stats.size,

                modifiedTime:
                    stats.mtimeMs,

                hash:
                    fileHash
            });
        }
    }
}


module.exports =
    FolderScanner;