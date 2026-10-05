class FolderComparator {

    static compareFolders(
        sourceFiles,
        destinationFiles
    ) {

        if (!Array.isArray(sourceFiles)) {

            throw new TypeError(
                "sourceFiles must be an array"
            );
        }


        if (!Array.isArray(destinationFiles)) {

            throw new TypeError(
                "destinationFiles must be an array"
            );
        }


        const destinationMap =
            new Map();


        for (const file of destinationFiles) {

            destinationMap.set(
                file.relativePath,
                file
            );
        }


        const result = {

            newFiles: [],

            modifiedFiles: [],

            unchangedFiles: []
        };


        for (const sourceFile of sourceFiles) {

            const destinationFile =
                destinationMap.get(
                    sourceFile.relativePath
                );


            if (!destinationFile) {

                result.newFiles.push(
                    sourceFile
                );

                continue;
            }


            if (
                sourceFile.hash !==
                destinationFile.hash
            ) {

                result.modifiedFiles.push(
                    sourceFile
                );

                continue;
            }


            result.unchangedFiles.push(
                sourceFile
            );
        }


        return result;
    }
}


module.exports =
    FolderComparator;