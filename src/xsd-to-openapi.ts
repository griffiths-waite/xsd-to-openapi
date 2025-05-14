import { XMLParser } from 'fast-xml-parser';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { basename, dirname, join } from 'path';

const openApiTypeMap = {
    string: 'string',
    decimal: 'number',
    float: 'number',
    double: 'number',
    integer: 'integer',
    boolean: 'boolean',
    date: 'string',
    dateTime: 'string',
    time: 'string',
} as const;

type OpenApiType = keyof typeof openApiTypeMap;

export interface OpenApiSpec {
    openapi: string;
    info: {
        title: string;
        description: string;
        version: string;
    };
    paths: Record<string, PathItem>;
}

interface PathItem {
    [key: string]: Operation | undefined;
}

interface SchemaProperty {
    type: string;
    items?: Schema;
    properties?: Record<string, SchemaProperty>;
    default?: string;
    fixed?: string;
    description?: string;
    required?: string[];
}

interface Schema {
    type: string;
    properties?: Record<string, SchemaProperty>;
    required?: string[];
    items?: Schema;
}

interface Operation {
    summary: string;
    description?: string;
    requestBody?: {
        required: boolean;
        content: Record<string, { schema: Schema }>;
    };
    responses: Record<
        string,
        {
            description?: string;
            content?: Record<string, { schema: Schema }>;
        }
    >;
}

interface XsdImport {
    '@_namespace': string;
    '@_schemaLocation': string;
}

interface XsdAnnotation {
    'xsd:documentation': string;
}

interface XsdElement {
    '@_name': string;
    '@_type'?: string;
    '@_maxOccurs'?: string;
    '@_minOccurs'?: string;
    '@_default'?: string;
    '@_fixed'?: string;
    'xsd:annotation'?: XsdAnnotation[];
}

interface XsdSequence {
    'xsd:element': XsdElement[];
    'xsd:choice'?: XsdChoice[];
}

interface XsdChoice {
    'xsd:sequence': XsdSequence[];
}

interface XsdComplexType {
    '@_name': string;
    'xsd:sequence'?: XsdSequence[];
    'xsd:choice'?: XsdChoice[];
}

interface XsdSchema {
    '@_targetNamespace'?: string;
    '@_id'?: string;
    'xsd:annotation'?: {
        'xsd:documentation'?: string;
    };
    'xsd:complexType': XsdComplexType[] | XsdComplexType;
    'xsd:simpleType'?: unknown[] | unknown;
    'xsd:element': XsdElement[] | XsdElement;
    'xsd:import'?: XsdImport[];
    [key: string]: any; // Required for detecting xml namespace prefixes
}

interface XsdObject {
    'xsd:schema': XsdSchema;
}

export interface XsdToOpenApiConfig {
    inputFilePath?: string;
    outputFilePath?: string;
    schemaName?: string;
    xsdContent?: string;
    useSchemaNameInPath?: boolean;
}

/**
 * Converts XSD schema to OpenAPI3.0 specification
 */
export async function xsdToOpenApi({
    inputFilePath,
    outputFilePath,
    schemaName,
    xsdContent,
    useSchemaNameInPath = false,
}: XsdToOpenApiConfig) {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        isArray: (name: string): boolean => {
            const arrayElements = [
                'xsd:element',
                'xsd:complexType',
                'xsd:simpleType',
                'xsd:attribute',
                'xsd:sequence',
                'xsd:choice',
                'xs:element',
                'xs:complexType',
                'xs:simpleType',
                'xs:attribute',
                'xs:sequence',
                'xs:choice',
                'xsd:import',
            ];
            return arrayElements.includes(name);
        },
    });

    try {
        const xsdObj: XsdObject = inputFilePath
            ? parser.parse(await readFile(inputFilePath, 'utf8'))
            : parser.parse(xsdContent || '');

        const specName = schemaName || basename(inputFilePath || '', '.xsd');

        if (!xsdObj['xsd:schema']) {
            throw new Error('Invalid XSD schema: No schema found');
        }

        const generatedSpec = await generateOpenApiSpec(
            xsdObj['xsd:schema'],
            specName.toLowerCase(),
            inputFilePath || '',
            useSchemaNameInPath,
            parser,
        );

        const openapiJson = JSON.stringify(generatedSpec, undefined, 2);

        if (outputFilePath) {
            if (!existsSync(outputFilePath)) await mkdir(dirname(outputFilePath), { recursive: true });

            await writeFile(outputFilePath, openapiJson, { flag: 'w+' });
        } else {
            throw new Error('Output file path is not specified');
        }
    } catch (error) {
        throw new Error(`Error reading XSD file: ${error}`);
    }
}

type ImportedSchemasMap = Record<string, XsdSchema>;

function resolveReferencedSchema(
    schema: XsdSchema,
    typeName: string,
    resolvedTypes = new Set<string>(),
    importedSchemas?: ImportedSchemasMap,
): Schema {
    if (resolvedTypes.has(typeName)) {
        return { type: 'object', properties: {} }; // Break circular references
    }

    resolvedTypes.add(typeName);
    return generateSchema({ schema, typeName, resolvedTypes, importedSchemas });
}

function getSequenceElements(complexType: XsdComplexType): XsdElement[] {
    if (complexType['xsd:sequence']?.[0]) {
        if (complexType['xsd:sequence'][0]['xsd:choice']?.[0]) {
            return complexType['xsd:sequence'][0]['xsd:choice']?.[0]?.['xsd:sequence']?.[0]?.['xsd:element'] || [];
        }
        return complexType['xsd:sequence'][0]['xsd:element'];
    }

    if (complexType['xsd:choice']?.[0]?.['xsd:sequence']?.[0]) {
        return complexType['xsd:choice'][0]['xsd:sequence'][0]['xsd:element'];
    }

    return [];
}

type GenerateSchemaParams = {
    schema: XsdSchema;
    typeName: string;
    resolvedTypes?: Set<string>;
    importedSchemas?: ImportedSchemasMap;
};

function generateSchema({
    schema,
    typeName,
    resolvedTypes = new Set<string>(),
    importedSchemas,
}: GenerateSchemaParams) {
    const complexTypes: XsdComplexType[] = Array.isArray(schema['xsd:complexType'])
        ? schema['xsd:complexType']
        : [schema['xsd:complexType']];

    const complexType = complexTypes.find((ct) => ct['@_name'] === typeName);

    // If the complex type is not found, then return an empty schema
    if (!complexType) {
        return { type: 'object', properties: {} };
    }

    const sequenceElements = getSequenceElements(complexType);

    const schemaType = sequenceElements.length > 0 ? 'object' : 'string'; // Default to string if no elements found

    const openApiSchema: Schema = { type: schemaType };

    sequenceElements.forEach((element: XsdElement) => {
        const subElementName = element['@_name'];
        const elementMaxOccurs = element['@_maxOccurs'];
        const { prefix, typeName: elementType } = resolveType(element);

        let propertySchema: Schema | SchemaProperty;

        if (prefix && importedSchemas?.[prefix]) {
            const importedSchema = importedSchemas[prefix];
            propertySchema = resolveReferencedSchema(importedSchema, elementType, resolvedTypes, importedSchemas);
        } else if (!prefix && elementType) {
            const formattedElementType = elementType.replace('xsd:', '').replace('xs:', '');
            const mappedElementType = openApiTypeMap[formattedElementType as OpenApiType];

            mappedElementType
                ? (propertySchema = { type: mappedElementType })
                : (propertySchema = resolveReferencedSchema(schema, elementType, resolvedTypes, importedSchemas));
        } else {
            propertySchema = { type: 'string' }; // Default to string if no type is found
        }

        const property: SchemaProperty =
            elementMaxOccurs === 'unbounded'
                ? {
                      type: 'array',
                      items: propertySchema,
                  }
                : propertySchema;

        const elementMinOccurs = element['@_minOccurs'] || null;
        const elementDefault = element['@_default'] || null;
        const elementFixed = element['@_fixed'] || null;
        const elementDescription = element['xsd:annotation']?.[0]?.['xsd:documentation'] || null;

        if (!elementMinOccurs || elementMinOccurs === '1') {
            if (!openApiSchema.required) {
                openApiSchema.required = [];
            }

            if (property.type !== 'array') {
                openApiSchema.required.push(subElementName);
            }
        }

        if (elementDefault) property.default = elementDefault;
        if (elementFixed) property.fixed = elementFixed;
        if (elementDescription) property.description = elementDescription;

        if (!openApiSchema.properties) {
            openApiSchema.properties = {};
        }

        openApiSchema.properties[subElementName] = property;
    });

    return openApiSchema;
}

type NamespacePrefixMap = Map<string, { prefix: string }>;

function extractElementTypePrefixes(schema: XsdSchema) {
    const prefixes: NamespacePrefixMap = new Map();
    const xmlNamespaceTag = '@_xmlns:';

    Object.keys(schema).forEach((key) => {
        if (key.startsWith(xmlNamespaceTag)) {
            const prefix = key.slice(xmlNamespaceTag.length);

            // Avoid adding reserved XML namespace prefixes
            if (prefix !== 'xsd' && prefix !== 'xs') {
                prefixes.set(schema[key], { prefix });
                // Key is set to the namespace URI, value is the namsepace prefix
            }
        }
    });

    return prefixes;
}

async function getImportedSchemas(
    xsdImports: XsdImport[] | undefined,
    inputFilePath: string,
    parser: XMLParser,
    elementTypePrefixes: NamespacePrefixMap,
) {
    const importedSchemas: ImportedSchemasMap = {};

    if (!xsdImports || xsdImports.length === 0 || !inputFilePath) return;

    await Promise.all(
        xsdImports.map(async (xsdImport) => {
            const namespacePrefix = elementTypePrefixes.get(xsdImport['@_namespace'])?.prefix || '';

            if (namespacePrefix) {
                const importFileName = xsdImport['@_schemaLocation'].endsWith('.xsd')
                    ? xsdImport['@_schemaLocation']
                    : `${xsdImport['@_schemaLocation']}.xsd`;
                const importFilePath = join(dirname(inputFilePath), importFileName);

                const parsedXsd = parser.parse(await readFile(importFilePath, 'utf8'));

                const importedSchema = parsedXsd['xsd:schema'] || parsedXsd['xs:schema'];

                if (importedSchema) {
                    importedSchemas[namespacePrefix] = importedSchema;
                } else {
                    throw new Error(`Invalid XSD schema: No schema found in ${importFilePath}`);
                }
            }
        }),
    );

    return importedSchemas;
}

type ResolveTypeResult = { prefix?: string; typeName: string };

function resolveType(element?: XsdElement): ResolveTypeResult {
    const rawType = element?.['@_type'];

    if (!rawType) return { typeName: 'string' };

    if (rawType.startsWith('tns:')) {
        return { typeName: rawType.slice(4) };
    }

    const typeParts = rawType.split(':');
    if (typeParts.length === 2 && typeParts[0] !== 'xsd' && typeParts[0] !== 'xs') {
        return { prefix: typeParts[0], typeName: typeParts[1] || 'string' };
    }

    return { typeName: rawType };
}

const notOkSchema: Schema = {
    type: 'object',
    properties: {
        Nok: {
            type: 'object',
            properties: {
                Code: { type: 'string' },
                Description: { type: 'string' },
                VariableList: {
                    type: 'object',
                    properties: {
                        Variable: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    Context: { type: 'string' },
                                    Value: { type: 'string' },
                                },
                                required: ['Value'],
                            },
                        },
                    },
                },
            },
            required: ['Code'],
        },
    },
};

async function generateOpenApiSpec(
    schema: XsdObject['xsd:schema'],
    schemaName: string,
    inputFilePath: string,
    useSchemaNameInPath: boolean,
    parser: XMLParser,
) {
    const openApiSpec: OpenApiSpec = {
        openapi: '3.1.0',
        info: {
            title: schemaName,
            description: `OpenAPI 3.0 specification generated from XSD schema ${schemaName}`,
            version: '1.0.0',
        },
        paths: {},
    };

    const importedSchemas = await getImportedSchemas(
        schema['xsd:import'] || schema['xs:import'],
        inputFilePath,
        parser,
        extractElementTypePrefixes(schema),
    );

    const elements = Array.isArray(schema['xsd:element']) ? schema['xsd:element'] : [schema['xsd:element']];

    const groupedElements = elements.reduce((acc, element) => {
        const pathName = element['@_name'].replace('Req', '').replace('Res', '');
        if (!acc[pathName]) acc[pathName] = {};
        if (element['@_name'].endsWith('Req')) acc[pathName].request = element;
        if (element['@_name'].endsWith('Res')) acc[pathName].response = element;
        return acc;
    }, {} as Record<string, { request?: XsdElement; response?: XsdElement }>);

    Object.entries(groupedElements).forEach(([pathName, { request, response }]) => {
        const openApiPathName = useSchemaNameInPath ? `/${schemaName}/${pathName}` : `/${pathName}`;

        const openApiPath = {
            post: {
                summary: `POST ${openApiPathName}`,
                description: '',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { type: 'object' },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'OK',
                        content: {
                            'application/json': {
                                schema: { type: 'object' },
                            },
                        },
                    },
                    '500': {
                        description: 'Internal server error',
                        content: {
                            'application/json': {
                                schema: notOkSchema,
                            },
                        },
                    },
                },
            },
        } satisfies PathItem;

        openApiPath.post.requestBody.content['application/json'].schema = generateSchema({
            schema,
            typeName: resolveType(request).typeName,
            importedSchemas,
        });
        openApiPath.post.responses['200'].content['application/json'].schema = generateSchema({
            schema,
            typeName: resolveType(response).typeName,
            importedSchemas,
        });

        openApiSpec.paths[openApiPathName] = openApiPath;
    });

    return openApiSpec;
}
