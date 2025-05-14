import { mkdir, readdir, rmdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { xsdToOpenApi } from "./xsd-to-openapi";

const defaultXsdSchema = `
<?xml version="1.0" encoding="UTF-8"?>
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <xsd:element name="TestReq" type="tTestReq"/>
    <xsd:complexType name="tTestReq">
        <xsd:sequence>
            <xsd:element name="stringField" type="xsd:string"/>
            <xsd:element name="numberField" type="xsd:decimal"/>
        </xsd:sequence>
    </xsd:complexType>
</xsd:schema>
`;

describe("XSD to OpenAPI Converter", () => {
    const xsdDir = path.join(__dirname, "XSD");
    const outputDir = path.join(__dirname, "open-api");

    beforeAll(async () => {
        await mkdir(xsdDir, { recursive: true });
        await mkdir(outputDir, { recursive: true });
    });

    afterAll(async () => {
        const xsdFiles = await readdir(xsdDir);
        const outputFiles = await readdir(outputDir);

        await Promise.all([
            ...xsdFiles.map((file) => unlink(path.join(xsdDir, file))),
            ...outputFiles.map((file) => unlink(path.join(outputDir, file))),
            rmdir(xsdDir),
            rmdir(outputDir),
        ]);
    });

    it("should convert an XSD schema from a file", async () => {
        const inputPath = path.join(xsdDir, "basic.xsd");
        const outputPath = path.join(outputDir, "basic.json");

        await writeFile(inputPath, defaultXsdSchema);
        await xsdToOpenApi({
            inputFilePath: inputPath,
            outputFilePath: outputPath,
            schemaName: "basictest",
            useSchemaNameInPath: true,
        });

        const result = require(outputPath);
        expect(result.openapi).toBe("3.1.0");
        expect(result.paths["/basictest/Test"]).toBeDefined();
        expect(result.paths["/basictest/Test"].post.requestBody.content["application/json"].schema).toMatchObject({
            type: "object",
            properties: {
                stringField: { type: "string" },
                numberField: { type: "number" },
            },
        });
    });

    it("should convert an XSD schema from a string", async () => {
        const outputFilePath = path.join(outputDir, "basic-string.json");
        await xsdToOpenApi({
            xsdContent: defaultXsdSchema,
            outputFilePath,
            schemaName: "basictest",
            useSchemaNameInPath: true,
        });

        const result = require(outputFilePath);
        expect(result.openapi).toBe("3.1.0");
        expect(result.paths["/basictest/Test"]).toBeDefined();
        expect(result.paths["/basictest/Test"].post.requestBody.content["application/json"].schema).toMatchObject({
            type: "object",
            properties: {
                stringField: { type: "string" },
                numberField: { type: "number" },
            },
        });
    });

    it("should throw error for invalid XSD content", async () => {
        const invalidXsd = `invalid xml content`;

        await expect(
            xsdToOpenApi({
                xsdContent: invalidXsd,
                outputFilePath: path.join(outputDir, "invalid.json"),
                useSchemaNameInPath: true,
            }),
        ).rejects.toThrowError("Error reading XSD file: Error: Invalid XSD schema: No schema found");
    });

    it("should convert an XSD schema with complex types", async () => {
        const complexXsdContent = `
            <?xml version="1.0" encoding="UTF-8"?>
            <xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema">
                <xsd:element name="TestReq" type="tTestReq"/>
                <xsd:complexType name="tTestReq">
                    <xsd:sequence>
                        <xsd:element name="stringField" type="xsd:string"/>
                        <xsd:element name="numberField" type="xsd:decimal"/>
                        <xsd:element name="nestedField" type="tns:tNestedType"/>
                    </xsd:sequence>
                </xsd:complexType>
                <xsd:complexType name="tNestedType">
                    <xsd:sequence>
                        <xsd:element name="nestedString" type="xsd:string"/>
                    </xsd:sequence>
                </xsd:complexType>
            </xsd:schema>
        `;

        const outputFilePath = path.join(outputDir, "complex.json");
        await xsdToOpenApi({
            xsdContent: complexXsdContent,
            outputFilePath,
            schemaName: "complexTest",
            useSchemaNameInPath: true,
        });

        const result = require(outputFilePath);
        expect(result.openapi).toBe("3.1.0");
        expect(result.paths["/complextest/Test"]).toBeDefined();
        expect(result.paths["/complextest/Test"].post.requestBody.content["application/json"].schema).toMatchObject({
            type: "object",
            properties: {
                stringField: { type: "string" },
                numberField: { type: "number" },
                nestedField: {
                    type: "object",
                    properties: {
                        nestedString: { type: "string" },
                    },
                },
            },
        });
    });

    it('should handle arrays with maxOccurs="unbounded"', async () => {
        const arrayXsdContent = `
            <?xml version="1.0" encoding="UTF-8"?>
            <xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema">
                <xsd:element name="TestReq" type="tTestReq"/>
                <xsd:complexType name="tTestReq">
                    <xsd:sequence>
                        <xsd:element name="items" type="xsd:string" maxOccurs="unbounded"/>
                    </xsd:sequence>
                </xsd:complexType>
            </xsd:schema>
        `;

        const outputFilePath = path.join(outputDir, "array.json");
        await xsdToOpenApi({
            xsdContent: arrayXsdContent,
            outputFilePath,
            schemaName: "arrayTest",
            useSchemaNameInPath: true,
        });

        const result = require(outputFilePath);
        expect(result.paths["/arraytest/Test"].post.requestBody.content["application/json"].schema).toMatchObject({
            type: "object",
            properties: {
                items: {
                    type: "array",
                    items: { type: "string" },
                },
            },
        });
    });

    it("should handle elements with default values", async () => {
        const defaultValuesXsdContent = `
            <?xml version="1.0" encoding="UTF-8"?>
            <xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema">
                <xsd:element name="TestReq" type="tTestReq"/>
                <xsd:complexType name="tTestReq">
                    <xsd:sequence>
                        <xsd:element name="field" type="xsd:string" default="defaultValue"/>
                    </xsd:sequence>
                </xsd:complexType>
            </xsd:schema>
        `;

        const outputFilePath = path.join(outputDir, "defaults.json");
        await xsdToOpenApi({
            xsdContent: defaultValuesXsdContent,
            outputFilePath,
            schemaName: "defaultsTest",
            useSchemaNameInPath: true,
        });

        const result = require(outputFilePath);
        expect(result.paths["/defaultstest/Test"].post.requestBody.content["application/json"].schema).toMatchObject({
            type: "object",
            properties: {
                field: {
                    type: "string",
                    default: "defaultValue",
                },
            },
        });
    });

    it("should handle required fields based on minOccurs", async () => {
        const requiredFieldsXsdContent = `
            <?xml version="1.0" encoding="UTF-8"?>
            <xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema">
                <xsd:element name="TestReq" type="tTestReq"/>
                <xsd:complexType name="tTestReq">
                    <xsd:sequence>
                        <xsd:element name="required" type="xsd:string" minOccurs="1"/>
                        <xsd:element name="optional" type="xsd:string" minOccurs="0"/>
                    </xsd:sequence>
                </xsd:complexType>
            </xsd:schema>
        `;

        const outputFilePath = path.join(outputDir, "required.json");
        await xsdToOpenApi({
            xsdContent: requiredFieldsXsdContent,
            outputFilePath,
            schemaName: "requiredTest",
            useSchemaNameInPath: true,
        });

        const result = require(outputFilePath);
        expect(result.paths["/requiredtest/Test"].post.requestBody.content["application/json"].schema).toMatchObject({
            type: "object",
            properties: {
                required: { type: "string" },
                optional: { type: "string" },
            },
            required: ["required"],
        });
    });

    it("should use the correct pathname when a schema name is passed in", async () => {
        const outputFilePath = path.join(outputDir, "schema-name.json");
        await xsdToOpenApi({
            xsdContent: defaultXsdSchema,
            outputFilePath,
            schemaName: "customSchemaName",
            useSchemaNameInPath: true,
        });

        const result = require(outputFilePath);
        expect(result.openapi).toBe("3.1.0");
        expect(result.paths["/customschemaname/Test"]).toBeDefined();
        expect(
            result.paths["/customschemaname/Test"].post.requestBody.content["application/json"].schema,
        ).toMatchObject({
            type: "object",
            properties: {
                stringField: { type: "string" },
                numberField: { type: "number" },
            },
        });
    });

    it("should use the filename as the schema name if a schema name is not provided", async () => {
        const inputPath = path.join(xsdDir, "filename-schema.xsd");
        const outputFilePath = path.join(outputDir, "filename-schema.json");

        await writeFile(inputPath, defaultXsdSchema);
        await xsdToOpenApi({
            inputFilePath: inputPath,
            outputFilePath,
            useSchemaNameInPath: true,
        });

        const result = require(outputFilePath);
        expect(result.openapi).toBe("3.1.0");
        expect(result.paths["/filename-schema/Test"]).toBeDefined();
        expect(result.paths["/filename-schema/Test"].post.requestBody.content["application/json"].schema).toMatchObject(
            {
                type: "object",
                properties: {
                    stringField: { type: "string" },
                    numberField: { type: "number" },
                },
            },
        );
    });
});
