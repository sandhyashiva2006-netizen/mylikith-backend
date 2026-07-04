function requireFields(data, fields) {

    for (const field of fields) {

        if (
            data[field] === undefined ||
            data[field] === null ||
            data[field] === ""
        ) {

            return {
                success: false,
                field
            };

        }

    }

    return {
        success: true
    };

}

module.exports = {
    requireFields
};