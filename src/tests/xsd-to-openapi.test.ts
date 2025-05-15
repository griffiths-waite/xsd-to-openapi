import { mkdir, readFile, rm } from "fs/promises";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { xsdToOpenApi } from "../xsd-to-openapi";

describe("XSD to OpenAPI Converter", () => {
    const fixturesDir = path.join(__dirname, "fixtures");
    const outputDir = path.join(__dirname, "open-api");

    beforeAll(async () => {
        await mkdir(outputDir, { recursive: true });
    });

    afterAll(async () => {
        await rm(outputDir, { recursive: true, force: true });
    });

    it("should convert an XSD schema from a file", async () => {
        const inputPath = path.join(fixturesDir, "basic.xsd");
        const outputPath = path.join(outputDir, "basic.json");

        await xsdToOpenApi({
            inputFilePath: inputPath,
            outputFilePath: outputPath,
            schemaName: "basictest",
            specGenerationOptions: {
                openApiVersion: "3.1.0",
                useSchemaNameInPath: true,
            },
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
        const inputFile = path.join(fixturesDir, "basic.xsd");
        const xsdContent = await readFile(inputFile, "utf-8");
        const outputFilePath = path.join(outputDir, "basic-string.json");
        await xsdToOpenApi({
            xsdContent,
            outputFilePath,
            schemaName: "basictest",
            specGenerationOptions: {
                openApiVersion: "3.1.0",
                useSchemaNameInPath: true,
            },
        });

        const result = require(outputFilePath);
        expect(result.paths["/basictest/Test"]).toBeDefined();
        expect(result.paths["/basictest/Test"].post.requestBody.content["application/json"].schema).toMatchObject({
            type: "object",
            properties: {
                stringField: { type: "string" },
                numberField: { type: "number" },
            },
        });
    });

    it("should convert an XSD schema with complex types", async () => {
        const inputFilePath = path.join(fixturesDir, "complex-types.xsd");
        const outputFilePath = path.join(outputDir, "complex-types.json");
        await xsdToOpenApi({
            inputFilePath,
            outputFilePath,
            schemaName: "complexTest",
            specGenerationOptions: {
                useSchemaNameInPath: true,
            },
        });

        const result = require(outputFilePath);
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
        const inputFilePath = path.join(fixturesDir, "arrays.xsd");
        const outputFilePath = path.join(outputDir, "arrays.json");
        await xsdToOpenApi({
            inputFilePath,
            outputFilePath,
            schemaName: "arrayTest",
            specGenerationOptions: {
                useSchemaNameInPath: true,
            },
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
        const inputFilePath = path.join(fixturesDir, "default-value.xsd");
        const outputFilePath = path.join(outputDir, "default-value.json");
        await xsdToOpenApi({
            inputFilePath,
            outputFilePath,
            schemaName: "defaultsTest",
            specGenerationOptions: {
                useSchemaNameInPath: true,
            },
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
        const inputFilePath = path.join(fixturesDir, "required-fields.xsd");
        const outputFilePath = path.join(outputDir, "required-fields.json");
        await xsdToOpenApi({
            inputFilePath,
            outputFilePath,
            schemaName: "requiredTest",
            specGenerationOptions: {
                useSchemaNameInPath: true,
            },
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
        const inputFilePath = path.join(fixturesDir, "basic.xsd");
        const outputFilePath = path.join(outputDir, "schema-name.json");
        await xsdToOpenApi({
            inputFilePath,
            outputFilePath,
            schemaName: "customSchemaName",
            specGenerationOptions: {
                useSchemaNameInPath: true,
            },
        });

        const result = require(outputFilePath);
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
        const inputFilePath = path.join(fixturesDir, "filename-schema.xsd");
        const outputFilePath = path.join(outputDir, "filename-schema.json");

        await xsdToOpenApi({
            inputFilePath,
            outputFilePath,
            specGenerationOptions: {
                useSchemaNameInPath: true,
            },
        });

        const result = require(outputFilePath);
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

    it("should handle custom request and response suffixes correctly", async () => {
        const inputFilePath = path.join(fixturesDir, "book-service.xsd");
        const outputFilePath = path.join(outputDir, "book-service.json");

        await xsdToOpenApi({
            inputFilePath,
            outputFilePath,
            schemaName: "bookservice",
            specGenerationOptions: {
                useSchemaNameInPath: true,
                requestSuffix: "Request",
                responseSuffix: "Response",
                httpMethod: "post",
            },
        });

        const result = require(outputFilePath);
        expect(result.paths["/bookservice/GetBook"]).toBeDefined();

        expect(result.paths["/bookservice/GetBook"].post.requestBody).toBeDefined();
        expect(result.paths["/bookservice/GetBook"].post.requestBody.content["application/json"].schema).toMatchObject({
            type: "object",
            properties: {
                bookId: { type: "string" },
            },
        });

        expect(result.paths["/bookservice/GetBook"].post.responses).toBeDefined();
        expect(result.paths["/bookservice/GetBook"].post.responses["200"]).toBeDefined();
        expect(
            result.paths["/bookservice/GetBook"].post.responses["200"].content["application/json"].schema,
        ).toMatchObject({
            type: "object",
            properties: {
                Book: {
                    type: "object",
                    properties: {
                        ID: { type: "string" },
                        Title: { type: "string" },
                        Author: { type: "string" },
                        PublishedYear: { type: "string" },
                        ISBN: { type: "string" },
                    },
                },
            },
        });
    });

    it("should handle importing XSD schemas with relative paths", async () => {
        const inputFilePath = path.join(fixturesDir, "ordering.xsd");
        const outputFilePath = path.join(outputDir, "ordering.json");

        await xsdToOpenApi({
            inputFilePath,
            outputFilePath,
            schemaName: "ordering",
            specGenerationOptions: {
                useSchemaNameInPath: true,
                requestSuffix: "Request",
                responseSuffix: "Response",
            },
        });

        const result = require(outputFilePath);

        expect(result.paths["/ordering/CreateOrder"]).toBeDefined();
        expect(result.paths["/ordering/CreateOrder"].post.requestBody).toBeDefined();
        expect(result.paths["/ordering/CreateOrder"].post.requestBody.content["application/json"].schema).toMatchObject(
            {
                type: "object",
                required: ["PurchaseOrder"],
                properties: {
                    PurchaseOrder: {
                        type: "object",
                        required: ["OrderID", "OrderDate", "Customer", "Items"],
                        properties: {
                            OrderID: {
                                type: "string",
                            },
                            OrderDate: {
                                type: "string",
                            },
                            Customer: {
                                type: "object",
                                required: ["CustomerID", "Name", "Address"],
                                properties: {
                                    CustomerID: {
                                        type: "string",
                                    },
                                    Name: {
                                        type: "string",
                                    },
                                    Address: {
                                        type: "object",
                                        required: ["Street", "City"],
                                        properties: {
                                            Street: {
                                                type: "string",
                                            },
                                            City: {
                                                type: "string",
                                            },
                                        },
                                    },
                                },
                            },
                            Items: {
                                type: "object",
                                required: [],
                                properties: {
                                    Item: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            required: ["ItemID", "Quantity", "Price"],
                                            properties: {
                                                ItemID: {
                                                    type: "string",
                                                },
                                                Quantity: {
                                                    type: "integer",
                                                },
                                                Price: {
                                                    type: "number",
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                            Comments: {
                                type: "string",
                            },
                        },
                    },
                },
            },
        );
    });

    it("should handle an XSD schema with no elements", async () => {
        const inputFilePath = path.join(fixturesDir, "no-elements.xsd");
        const outputFilePath = path.join(outputDir, "no-elements.json");

        await xsdToOpenApi({
            inputFilePath,
            outputFilePath,
            specGenerationOptions: {
                useSchemaNameInPath: false,
            },
        });

        const result = require(outputFilePath);
        expect(result.paths["/NoElements"]).toBeDefined();
        expect(result.paths["/NoElements"].post.requestBody).toBeDefined();
        expect(result.paths["/NoElements"].post.requestBody.content["application/json"].schema).toMatchObject({
            type: "string",
        });
    });

    it("should handle an XSD schema with choice elements", async () => {
        const inputFilePath = path.join(fixturesDir, "choice-elements.xsd");
        const outputFilePath = path.join(outputDir, "choice-elements.json");

        await xsdToOpenApi({
            inputFilePath,
            outputFilePath,
            specGenerationOptions: {
                requestSuffix: "Request",
                responseSuffix: "Response",
                useSchemaNameInPath: false,
            },
        });

        const result = require(outputFilePath);
        expect(result.paths["/GetUserDetails"]).toBeDefined();
        expect(result.paths["/GetUserDetails"].post.responses[200]).toBeDefined();
        expect(result.paths["/GetUserDetails"].post.responses[200].content["application/json"].schema).toMatchObject({
            type: "object",
            properties: {
                UserDetails: {
                    oneOf: [
                        {
                            type: "object",
                            properties: {
                                Name: {
                                    type: "string",
                                },
                            },
                            required: ["Name"],
                        },
                        {
                            type: "object",
                            properties: {
                                Email: {
                                    type: "string",
                                },
                            },
                            required: ["Email"],
                        },
                        {
                            type: "object",
                            properties: {
                                PhoneNumber: {
                                    type: "string",
                                },
                            },
                            required: ["PhoneNumber"],
                        },
                    ],
                },
            },
            required: ["UserDetails"],
        });
    });

    it("should handle an XSD schema with choice elements in sequences", async () => {
        const inputFilePath = path.join(fixturesDir, "choice-elements.xsd");
        const outputFilePath = path.join(outputDir, "choice-elements.json");

        await xsdToOpenApi({
            inputFilePath,
            outputFilePath,
            specGenerationOptions: {
                requestSuffix: "Request",
                responseSuffix: "Response",
                useSchemaNameInPath: false,
            },
        });

        const result = require(outputFilePath);
        expect(result.paths["/ProcessPayment"]).toBeDefined();
        expect(result.paths["/ProcessPayment"].post.requestBody).toBeDefined();
    });

    it("should throw an error if no schema is found when providing XSD content as a file", async () => {
        const inputFilePath = path.join(fixturesDir, "no-schema-found.xsd");
        const outputFilePath = path.join(outputDir, "no-schema-found.json");

        await expect(
            xsdToOpenApi({
                inputFilePath,
                outputFilePath,
            }),
        ).rejects.toThrowError("No XSD schema found");
    });

    it("should throw an error if no schema is found when providing XSD content as a string", async () => {
        await expect(
            xsdToOpenApi({
                xsdContent: "invalid content",
                outputFilePath: path.join(outputDir, "invalid.json"),
            }),
        ).rejects.toThrowError("No XSD schema found");
    });

    it("should throw an error if the input file does not exist", async () => {
        const inputFilePath = path.join(fixturesDir, "nonexistent.xsd");
        const outputFilePath = path.join(outputDir, "nonexistent.json");

        await expect(
            xsdToOpenApi({
                inputFilePath,
                outputFilePath,
            }),
        ).rejects.toThrowError("Input file not found");
    });
});
