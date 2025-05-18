# xsd-to-openapi
A tool for converting XSD files to OpenAPI 3.0/3.1 JSON specifications.

## Installation
```bash
npm install xsd-to-openapi
```

## Usage
To use this tool, you may either specify an `inputFilePath` (the path to your XSD file) or provide the XSD content directly using the `xsdContent` property. The function returns a Promise that resolves to the generated OpenAPI specification object. For more details on available options, see the [Configuration section](#configuration).

**Generation from the file path of an XSD file**
```ts
import { xsdToOpenApi } from "xsd-to-openapi";
import path from "path";

const myXsdFilePath = path.join(__dirname, "xsdFiles/mySoapApi.xsd");
const myOutputFilePath = path.join(__dirname, "mySoapApi-openapi.json");

await xsdToOpenApi({
    inputFilePath: myXsdFilePath,
    outputFilePath: myOutputFilePath,
});
```
**Generation from an XSD as a string**
```ts
const myXsdString = `
<?xml version="1.0" encoding="UTF-8"?>
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <xsd:element name="MyXsdReq" type="MyXsdReq" />
    <xsd:complexType name="MyXsdReq">
        <xsd:sequence>
            <xsd:element name="stringField" type="xsd:string" />
            <xsd:element name="numberField" type="xsd:decimal" />
        </xsd:sequence>
    </xsd:complexType>

    <xsd:element name="MyXsdRes" type="MyXsdRes" />
    <xsd:complexType name="MyXsdRes">
        <xsd:sequence>
            <xsd:element name="stringField" type="xsd:string" />
            <xsd:element name="numberField" type="xsd:decimal" />
        </xsd:sequence>
    </xsd:complexType>
</xsd:schema>
`
await xsdToOpenApi({
    xsdContent: myXsdString,
    outputFilePath: myOutputFilePath,
});
```

If you want to write the JSON specification to a file, then you should also specify an `outputFilePath`. However, the generated specification can be consumed programmatically.

## Features
### XSD Support
- XSD parsing:
  - Supports elements, sequences, choices and complex types.
  - Handles nested elements and types.
  - Resolves references for elements and types (both internally and from imported XSD schemas).
- XSD schema imports:
  - Resolves imports from relative paths (requires `inputFilePath`).
  - Handle circular references between schemas.

### OpenAPI Spec Generation
- Generate OpenAPI 3.0/3.1 JSON specifications:
  - Automatically create paths from matching request/response elements.
  - Uses naming patterns to generate paths (e.g. `GetUserRequest` and `GetUserResponse` become `/GetUser`).
  - Configurable suffixes for identifying request/response elements for each endpoint.
  - Maps common XSD data types to basic JSON data types.

### Configuration
The tool can be configured with the following options:

| Option                                         | Type      | Description                                                                                                                                                                                         | Required |
| ---------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `inputFilePath`                                | `String`  | Path to the input XSD file.                                                                                                                                                                         | No       |
| `outputFilePath`                               | `String`  | Path where the OpenAPI JSON specification file will be written.                                                                                                                                     | No       |
| `xsdContent`                                   | `String`  | XSD content as a string (used if `inputFilePath` is not provided).                                                                                                                                  | No       |
| `schemaName`                                   | `String`  | Optional name for the API schema (used as the path name if `useSchemaNameInPath` is `true`).                                                                                                        | No       |
| `specGenerationOptions`                        | `Object`  | Additional options for customising the process of generating the OpenAPI spec.                                                                                                                      | No       |
| `specGenerationOptions.requestSuffix`          | `String`  | Suffix for identifying request elements by name (default: `"Req"`).                                                                                                                                 | No       |
| `specGenerationOptions.responseSuffix`         | `String`  | Suffix for identifying response elements by name (default: `"Res"`).                                                                                                                                | No       |
| `specGenerationOptions.useSchemaNameInPath`    | `Boolean` | Whether to include the schema name in the endpoint path (e.g. `schemaName/endpointName`) (default: `false`). If this is set to `true` and `schemaName` is not set, then the file name will be used. | No       |
| `specGenerationOptions.httpMethod`             | `String`  | HTTP method for all operations (default: `"post"`).                                                                                                                                                 | No       |
| `specGenerationOptions.contentType`            | `String`  | Content type for all operations (default: `"application/json"`).                                                                                                                                    | No       |
| `specGenerationOptions.error`                  | `Object`  | Optional error schema options (applied to all operations and is not included by default).                                                                                                           | No       |
| `specGenerationOptions.error.errorSchema`      | `Object`  | JSON schema for the error response.                                                                                                                                                                 | Yes      |
| `specGenerationOptions.error.errorStatusCode`  | `String`  | HTTP status code for the error response (e.g., `"400"`, `"500"`).                                                                                                                                   | Yes      |
| `specGenerationOptions.error.errorDescription` | `String`  | Description for the error response schema.                                                                                                                                                          | No       |