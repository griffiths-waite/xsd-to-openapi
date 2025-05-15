# xsd-to-openapi
A tool for converting XSD files to OpenAPI 3.0/3.1 JSON specifications.

## Installation
```
npm install xsd-to-openapi
```

## Usage
To use this tool, you will need to pass in either an `inputFilePath` for the XSD file or the content of the XSD file as a string.

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
// Generate and write an OpenAPI spec from a string
await xsdToOpenApi({
    xsdContent: myXsdString,
    outputFilePath: myOutputFilePath,
});
```

If you want to write the JSON specification to a file, then you should also specify an `outputFilePath`. However, the generated specification can be consumed programmatically.

## Features
### XSD Support
- XSD parsing:
  - Sequences, choices, complex types, attributes.
  - Nested elements and types.
  - Reference resolution for elements and types.
- XSD facet handling:
  - `minOccurs` and `maxOccurs` as array constraints (minItems and maxItems).
  - `default` and `fixed` values -> default properties.
- XSD schema imports:
  - Resolve imports from relative paths (requires `inputFilePath`).
  - Handle circular references between schemas.

### OpenAPI Spec Generation
- Generate OpenAPI 3.0/3.1 JSON specifications:
  - Automatically create paths from matching request/response elements.
  - Pair elements using naming patterns (e.g. `GetUserRequest` and `GetUserResponse` -> `/GetUser`).
  - Configurable request/response suffixes (default: `"Req"` and `"Res"`).
  - Maps XSD data types to JSON schema types.
  - Adds request bodies and responses with content types.
### Configuration
- `inputFilePath` - Path to the input XSD file
- `outputFilePath` - Path to the output OpenAPI JSON file
- `xsdContent` - XSD content as a string (used if `inputFilePath` is not passed in)
- `schemaName` - Optional name for the API schema (used as the pathname if `useSchemaNameInPath` flag is enabled)
- `specGenerationOptions`
  - `requestSuffix` - the suffix for getting request elements by name (default: `"Req"`).
  - `responseSuffix` - the suffix for getting request elements by name (default: `"Res"`).
  - `useSchemaNameInPath` - flag for setting the schema name in the path (default: `false`).
  - `httpMethod` - HTTP method for all operations (default: `"post"`).
  - `contentType` - Content type for all operations (default: `"applicaton/json"`).
  - `error` - Optional error schema options (used for all operations and is not included by default)
    - `errorSchema` - JSON schema for the error response.
    - `errorStatusCode` - HTTP status code for the error response.
    - `errorDescription` - Description for the error response schema.