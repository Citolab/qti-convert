<?xml version="1.0" encoding="UTF-8"?>
<!--     
     qti2xTo30.xsl - Transforms QTI 2.x content to QTI 3.0.
     
     Created By:     Patrick de Klein
     Citolab
     patrick.deklein@cito.nl
     
     Created Date:   2023-01-16
     
     NOTES:
     This XSL transformation requires a XSL 3.0 capable processor and has been developed/tested using the Saxon-HE
     Java implementation version 9.9.1.7.
     
     * TAO: matchInteraction default as tabular data in QTI3
     * TAO: matchInteraction not has class attribute add it with qti-match-tabular in the name
     * TAO: matchInteraction has class attribute add qti-match-tabular to existing class value
     * TAO: convert tao grid-row to the qti default
     * TAO: convert tao col-layout to the qti default
-->
<xsl:stylesheet xmlns:xi="http://www.w3.org/2001/XInclude" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:math="http://www.w3.org/2005/xpath-functions/math" xmlns:apip="http://www.imsglobal.org/xsd/apip/apipv1p0/imsapip_qtiv1p0"
                xmlns:mml="http://www.w3.org/1998/Math/MathML" xmlns:mml3="http://www.w3.org/2010/Math/MathML" xmlns:imx="http://ets.org/imex"
                xmlns:ssml="http://www.w3.org/2001/10/synthesis" xmlns:ssml11="http://www.w3.org/2010/10/synthesis"
                exclude-result-prefixes="apip imx math mml mml3 ssml ssml11 xi xs" version="3.0">
    
    <xsl:variable name="qti3NamespaceUri" select="'http://www.imsglobal.org/xsd/imsqtiasi_v3p0'"/>
    
    <xsl:template match="/">
        <xsl:apply-templates/>
    </xsl:template>
    
    <!-- TAO: matchInteraction default as tabular data in QTI3-->
    <!-- TAO: matchInteraction not has class attribute add it with qti-match-tabular in the name -->
    <xsl:template match="*:qti-match-interaction[not(@class)]">
        <xsl:element name="{name()}" namespace="{$qti3NamespaceUri}">
            <xsl:attribute name="class" select="'qti-match-tabular'" />
            <xsl:apply-templates select="@* | node()" />
        </xsl:element>
    </xsl:template>
    
    <!-- TAO: matchInteraction has class attribute add qti-match-tabular to existing class value -->
    <xsl:template match="*:qti-match-interaction[@class]">
        <xsl:element name="{name()}" namespace="{$qti3NamespaceUri}">
            <xsl:attribute name="class" select="concat('qti-match-tabular ', @class)" />
            <xsl:apply-templates select="@*[name(.)!='class']" />
            <xsl:apply-templates select="node()" />
        </xsl:element>
    </xsl:template>
    
    <!-- TAO: convert tao grid-row to the qti default -->
    <xsl:template match="@class[. = 'grid-row']">
        <!-- @ matches on attributes, possible to restrict! -->
        <xsl:attribute name="{name()}" select="'qti-layout-row'" />
    </xsl:template>
    
    <!-- TAO: convert tao col-layout to the qti default -->
    <xsl:template match="@*[starts-with(., 'col-')]">
        <xsl:attribute name="{name()}" namespace="{namespace-uri()}"
            select="concat('qti-layout-', replace(., '-', ''))" />
    </xsl:template>
    
</xsl:stylesheet>
